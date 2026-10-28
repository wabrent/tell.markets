import { getAddress, type Hex } from 'viem';
import { readToken } from './checks/contract.js';
import { cachedReport, getReport, isChecking } from './reports.js';
import { client, withBackoff } from './sources/rpc.js';
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
  launchpad: 'Pons';
}

const launches = new JsonStore<Launch>('launches.json', 3000);
let lastBlock = 0n;
let latestSeen = { block: 0n, at: 0 };

async function poll() {
  const latest = await withBackoff(() => client.getBlock());
  latestSeen = { block: latest.number, at: Number(latest.timestamp) * 1000 };
  const from = lastBlock ? lastBlock + 1n : latest.number - WINDOW_BLOCKS;
  if (from > latest.number) return;

  const logs = await withBackoff(() => client.request({
    method: 'eth_getLogs',
    params: [{ address: PONS_FACTORY, topics: [LAUNCH_TOPIC], fromBlock: `0x${from.toString(16)}`, toBlock: `0x${latest.number.toString(16)}` }],
  })) as { topics: Hex[]; blockNumber: Hex }[];
  lastBlock = latest.number;

  // newest first, a few at a time, so the top of the feed fills in before the backlog
  const fresh = [...logs].reverse().filter(l => !launches.get(('0x' + l.topics[1].slice(-40)).toLowerCase()));
  for (let i = 0; i < fresh.length; i += 8) {
    await Promise.all(fresh.slice(i, i + 8).map(async l => {
      const token = getAddress('0x' + l.topics[1].slice(-40)).toLowerCase();
      const block = BigInt(l.blockNumber);
      const info = await readToken(token as Hex).catch(() => undefined);
      launches.set(token, {
        token,
        deployer: ('0x' + l.topics[3].slice(-40)).toLowerCase(),
        block: block.toString(),
        at: latestSeen.at - Number(latest.number - block) / BLOCKS_PER_SEC * 1000,
        name: info?.name,
        symbol: info?.symbol,
        launchpad: 'Pons',
      });
    }));
  }
}

/**
 * Background checker: works through the last day's launches newest first, one at a time, so the
 * feed fills in without hammering the RPC. A token is re-checked when its report is an hour old.
 */
async function work() {
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
    try { await poll(); } catch (err) { console.error('launch poll failed', (err as Error).message); }
    setTimeout(tick, POLL_MS);
  };
  const loop = async () => {
    try { await work(); } catch { /* logged above */ }
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
        image: r?.meta?.image || pair?.info?.imageUrl,
        holders: r?.facts?.holders,
        liquidity: pair?.liquidity?.usd,
        marketCap: pair?.marketCap,
      };
    });
}
