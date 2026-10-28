import { getAddress, type Hex } from 'viem';
import { readToken } from './checks/contract.js';
import { cachedReport, getReport, isChecking, userBusy } from './reports.js';
import { launchMeta } from './sources/launch.js';
import { background, client, foregroundBusy, withBackoff } from './sources/rpc.js';
import { JsonStore } from './store.js';

// Pons V2 factory and its Launch event: topics = [sig, token, curve, deployer]
const PONS_FACTORY = '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e';
const LAUNCH_TOPIC = '0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607';
const BLOCKS_PER_SEC = 9.6; // measured on mainnet; only used to date launches without a block lookup
const WINDOW_BLOCKS = BigInt(Math.round(24 * 3600 * BLOCKS_PER_SEC));
const POLL_MS = 60_000;

export interface Launch {
  token: string;
  deployer: string;
  block: string;
  at: number; // ms, estimated from block height
  name?: string;
  symbol?: string;
  image?: string;
  description?: string;
  tx?: string;
  /** Set once the launch call has been read for its metadata. */
  metaDone?: boolean;
  launchpad: 'Pons';
}

const launches = new JsonStore<Launch>('launches.json', 3000);
let lastBlock = 0n;
let latestSeen = { block: 0n, at: 0 };
/** Every launch seen in the window (token -> time), including ones we haven't read metadata for. */
const seenAt = new Map<string, number>();
type LaunchLog = { topics: Hex[]; blockNumber: Hex; transactionHash: Hex };
/** Launch events seen but not yet read, newest first. */
let backlog: LaunchLog[] = [];

/**
 * Picks up new launch events. `limit` caps how many of the new ones get their metadata read in
 * this call: unlimited for the background watcher, small for the on-demand feed on serverless.
 */
async function poll(limit = Infinity) {
  const latest = await withBackoff(() => client.getBlock());
  latestSeen = { block: latest.number, at: Number(latest.timestamp) * 1000 };
  const from = lastBlock ? lastBlock + 1n : latest.number - WINDOW_BLOCKS;
  const logs = from > latest.number ? [] : await withBackoff(() => client.request({
    method: 'eth_getLogs',
    params: [{ address: PONS_FACTORY, topics: [LAUNCH_TOPIC], fromBlock: `0x${from.toString(16)}`, toBlock: `0x${latest.number.toString(16)}` }],
  })) as LaunchLog[];
  lastBlock = latest.number;

  for (const l of logs) {
    seenAt.set(('0x' + l.topics[1].slice(-40)).toLowerCase(), latestSeen.at - Number(latest.number - BigInt(l.blockNumber)) / BLOCKS_PER_SEC * 1000);
  }

  // newest first, a few at a time, so the top of the feed fills in before the backlog;
  // whatever doesn't fit under `limit` waits in the backlog for the next call
  const isNew = (l: LaunchLog) => !launches.get(('0x' + l.topics[1].slice(-40)).toLowerCase());
  const queue = [...[...logs].reverse(), ...backlog].filter(isNew);
  const fresh = queue.slice(0, limit);
  backlog = queue.slice(limit, limit + 3000);
  for (let i = 0; i < fresh.length; i += 25) {
    await Promise.all(fresh.slice(i, i + 25).map(async l => {
      const token = getAddress('0x' + l.topics[1].slice(-40)).toLowerCase();
      const block = BigInt(l.blockNumber);
      launches.set(token, await withMeta({
        token,
        deployer: ('0x' + l.topics[3].slice(-40)).toLowerCase(),
        block: block.toString(),
        at: latestSeen.at - Number(latest.number - block) / BLOCKS_PER_SEC * 1000,
        tx: l.transactionHash,
        launchpad: 'Pons',
      }));
    }));
  }

  // launches stored before metadata was read: fill in a few per tick
  if (limit === Infinity) {
    const old = launches.values().filter(l => !l.metaDone).sort((a, b) => b.at - a.at).slice(0, 16);
    for (const l of old) launches.set(l.token, await withMeta(l));
  }
}

/*
 * Serverless (Vercel) has no long-running process for the watcher, so the feed is built when
 * someone asks: one getLogs call for the whole day, metadata for the newest launches, reused for a
 * minute. Scores fill in as visitors check tokens; the page checks the newest few itself.
 */
const ON_DEMAND_LIMIT = 150; // rows shown
const ON_DEMAND_BATCH = 40;  // new launches read per refresh; the rest fill in on later refreshes
let refreshed = 0;
let refreshing: Promise<void> | undefined;

async function refreshOnDemand() {
  if (Date.now() - refreshed < 60_000) return;
  refreshing ??= poll(ON_DEMAND_BATCH)
    .then(() => { refreshed = Date.now(); })
    .catch(err => console.error('launch refresh failed', (err as Error).message))
    .finally(() => { refreshing = undefined; });
  // never hold a page for long: answer with what we have and let the refresh finish
  await Promise.race([refreshing, new Promise(r => setTimeout(r, 8000))]);
}

export async function launchesResponse(live: boolean) {
  if (!live) await refreshOnDemand();
  const day = Date.now() - 24 * 3600_000;
  const total = [...seenAt.values()].filter(t => t > day).length;
  const feed = launchFeed();
  return { mode: live ? 'live' : 'on-demand', total: Math.max(total, feed.length), launches: feed.slice(0, live ? 1000 : ON_DEMAND_LIMIT) };
}

/** Image, name and symbol come straight from the launch call: one request, before any check runs. */
async function withMeta(l: Launch): Promise<Launch> {
  let hash = l.tx as Hex | undefined;
  if (!hash) {
    const logs = await withBackoff(() => client.request({
      method: 'eth_getLogs',
      params: [{ address: PONS_FACTORY, topics: [LAUNCH_TOPIC, ('0x' + l.token.slice(2).padStart(64, '0')) as Hex], fromBlock: `0x${(BigInt(l.block) - 1n).toString(16)}`, toBlock: `0x${(BigInt(l.block) + 1n).toString(16)}` }],
    })).catch(() => []) as { transactionHash: Hex }[];
    hash = logs[0]?.transactionHash;
  }
  const meta = hash ? await withBackoff(() => client.getTransaction({ hash: hash! })).then(tx => launchMeta(tx.input)).catch(() => undefined) : undefined;
  let { name, symbol } = meta ?? {};
  if (!name || !symbol) {
    const info = await readToken(l.token as Hex).catch(() => undefined);
    name ??= info?.name; symbol ??= info?.symbol;
  }
  return { ...l, tx: hash, name: name ?? l.name, symbol: symbol ?? l.symbol, image: meta?.image ?? l.image, description: meta?.description ?? l.description, metaDone: true };
}

/**
 * Background checker: works through the last day's launches newest first, one at a time, so the
 * feed fills in without hammering the RPC. A token is re-checked when its report is an hour old.
 */
async function work() {
  if (userBusy() || foregroundBusy()) return; // people first
  const day = Date.now() - 24 * 3600_000;
  const next = launches.values()
    .filter(l => l.at > day && !isChecking(l.token))
    .filter(l => { const c = cachedReport(l.token); return !c || Date.now() - c.at > 3600_000; })
    .sort((a, b) => b.at - a.at)[0];
  if (!next) return;
  await getReport(next.token as Hex, { maxAge: 3600_000 }).catch(err => console.error('launch check failed', next.token, err?.message ?? err));
}

export function startLaunchWatcher() {
  const tick = async () => {
    try { await background.run(true, poll); } catch (err) { console.error('launch poll failed', (err as Error).message); }
    setTimeout(tick, POLL_MS);
  };
  const loop = async () => {
    try { await background.run(true, work); } catch { /* logged above */ }
    setTimeout(loop, 3000);
  };
  tick();
  setTimeout(loop, 5000);
}

/** The last day of launches with whatever we know about each. */
export function launchFeed() {
  const day = Date.now() - 24 * 3600_000;
  return launches.values()
    .filter(l => l.at > day)
    .sort((a, b) => b.at - a.at)
    .map(l => {
      const c = cachedReport(l.token);
      const r = c?.report;
      const pair = r?.pairs?.[0];
      return {
        ...l,
        checking: isChecking(l.token),
        checkedAt: c?.at,
        score: r?.score,
        verdict: r?.verdict,
        image: r?.meta?.image || pair?.info?.imageUrl || l.image,
        holders: r?.facts?.holders,
        liquidity: pair?.liquidity?.usd,
        marketCap: pair?.marketCap,
      };
    });
}
