import { zeroAddress, type Hex } from 'viem';
import { knownAsset } from './known.js';
import { BLOCKS_PER_SEC, LAUNCH_TOPIC, PONS_FACTORY } from './launches.js';
import { firstScores } from './reports.js';
import { getTokensPairs } from './sources/dexscreener.js';
import { fetchTransfers } from './sources/logs.js';
import { background, client, withBackoff } from './sources/rpc.js';
import { JsonStore } from './store.js';

/*
 * Does the score mean anything? For every token Tell scored, look at it once, 2 to 7 days after
 * its first check, and freeze what happened: did it reach a DEX pool, and does it still have
 * liquidity someone could sell into. Then compare outcomes across the risk levels Tell gave at
 * the start. A score that works should see high-risk tokens die far more often than low-risk ones.
 */

const MIN_AGE = 48 * 3600_000;
const MAX_AGE = 7 * 24 * 3600_000;
/** Liquidity below this is a token nobody can meaningfully sell. */
const ALIVE_USD = 5_000;

export interface Outcome {
  token: string;
  firstScore: number;
  firstAt: number;
  evaluatedAt: number;
  pool: boolean;
  liquidityUsd: number;
  marketCapUsd: number | null;
  alive: boolean;
}

const outcomes = new JsonStore<Outcome>('accuracy.json', 200_000);
let lastRun = 0;
let running = false;

const LEVELS = [
  { level: 'low', range: '0вЂ“29', lo: 0, hi: 29 },
  { level: 'medium', range: '30вЂ“59', lo: 30, hi: 59 },
  { level: 'caution', range: '60вЂ“79', lo: 60, hi: 79 },
  { level: 'high', range: '80вЂ“100', lo: 80, hi: 100 },
] as const;

async function evaluate() {
  if (running) return;
  running = true;
  try {
    const now = Date.now();
    const due = firstScores().filter(f =>
      !outcomes.get(f.token) && now - f.t >= MIN_AGE && now - f.t <= MAX_AGE && !knownAsset(f.token));
    for (let i = 0; i < due.length; i += 30) {
      const batch = due.slice(i, i + 30);
      let pairs;
      try { pairs = await getTokensPairs(batch.map(b => b.token)); } catch { await sleep(5000); continue; }
      for (const b of batch) {
        const own = pairs.filter(p => p.baseToken.address.toLowerCase() === b.token);
        const liq = Math.max(0, ...own.map(p => p.liquidity?.usd ?? 0));
        const mc = own.find(p => p.marketCap)?.marketCap ?? null;
        outcomes.set(b.token, { token: b.token, firstScore: b.s, firstAt: b.t, evaluatedAt: now, pool: own.length > 0, liquidityUsd: Math.round(liq), marketCapUsd: mc, alive: liq >= ALIVE_USD });
      }
      await sleep(400); // DexScreener allows ~300 calls a minute; stay well under
    }
    lastRun = now;
  } finally { running = false; }
}

/*
 * Rug check. Survival can't tell a scam from a launch nobody wanted, so the main measure asks what
 * Tell is actually for: after Tell scored the token, did the people with the knife use it?
 *
 * Every token is judged on the same clock: its state exactly RUG_HORIZON after the first check,
 * rebuilt from the on-chain transfer log (so old tokens can be judged as fairly as new ones).
 *   deployer dump: after the check the deployer held >= 0.5% of supply at some point, and by the
 *                  horizon had sold >= 90% of that peak
 *   holder exodus: after the check the token reached at least 20 holders, and by the horizon
 *                  half of them were gone
 *   sample:        tokens that reached at least 10 holders after the check. Tell checks launches in
 *                  their first minutes, before most buyers arrive, so "holders at the check" is
 *                  almost always 1 or 2; what matters is whether anyone came in afterwards.
 * Anything that happened before the first check doesn't count: Tell saw that and scored it.
 */
const RUG_HORIZON = 72 * 3600_000;
const RUG_MAX_AGE = 30 * 24 * 3600_000;
const DEAD = '0x000000000000000000000000000000000000dead';

export interface RugOutcome {
  token: string;
  firstScore: number;
  firstAt: number;
  evaluatedAt: number;
  horizonHours: number;
  holdersAtCheck: number;
  peakHolders: number;
  holdersAtHorizon: number;
  deployerPeakPct: number;
  deployerSoldPct: number;
  dumped: boolean;
  exodus: boolean;
  rug: boolean;
}

// v2: fixed horizon and peak-based measures; v1 results (holders at the check) are not comparable
const rugs = new JsonStore<RugOutcome>('accuracy-rugs-v2.json', 200_000);
/** Tokens we tried and could not judge (not a Pons launch, history too busy): don't retry forever. */
const rugSkip = new JsonStore<number>('accuracy-rugs-skip.json', 200_000);
let rugRunning = false;
let rugLastRun = 0;
// ~3 RPC calls a token, all in the background queue behind people's checks;
// 500 every 15 minutes backfills a month of history in hours and keeps up with ~1,600 launches a day
const RUG_BATCH = 500;

async function evaluateRugs() {
  if (rugRunning) return;
  rugRunning = true;
  try {
    await background.run(true, async () => {
      const now = Date.now();
      const latest = await withBackoff(() => client.getBlock());
      const blockAt = (t: number) => latest.number - BigInt(Math.max(0, Math.round((Number(latest.timestamp) * 1000 - t) / 1000 * BLOCKS_PER_SEC)));
      // newest eligible first, so the page reflects the current version of Tell soonest
      const due = firstScores()
        .filter(f => !rugs.get(f.token) && !rugSkip.get(f.token) && now - f.t >= RUG_HORIZON && now - f.t <= RUG_MAX_AGE && !knownAsset(f.token))
        .sort((a, b) => b.t - a.t)
        .slice(0, RUG_BATCH);
      for (const f of due) {
        try {
          const o = await rugOutcome(f.token as Hex, f.s, f.t, blockAt);
          if (o) rugs.set(f.token, o); else rugSkip.set(f.token, now);
        } catch (err) {
          console.error('rug check failed', f.token, (err as Error).message?.split('\n')[0]);
        }
      }
    });
    rugLastRun = Date.now();
  } finally { rugRunning = false; }
}

export async function rugOutcome(token: Hex, firstScore: number, firstAt: number, blockAt: (t: number) => bigint): Promise<RugOutcome | undefined> {
  // the launch happened before the first check; three days back covers Tell's own launch feed
  const { transfers, complete } = await fetchTransfers(token, 40_000, blockAt(firstAt - 3 * 24 * 3600_000));
  if (!complete) return undefined;
  const mint = transfers.find(t => t.from === zeroAddress);
  if (!mint) return undefined;

  // the deployer comes from the Pons launch event in the mint's block
  const logs = await withBackoff(() => client.request({
    method: 'eth_getLogs',
    params: [{ address: PONS_FACTORY, topics: [LAUNCH_TOPIC, ('0x' + token.slice(2).toLowerCase().padStart(64, '0')) as Hex], fromBlock: `0x${(mint.block - 1n).toString(16)}`, toBlock: `0x${(mint.block + 1n).toString(16)}` }],
  })) as { topics: Hex[] }[];
  if (!logs.length) return undefined; // not a Pons launch: no deployer to follow
  const deployer = ('0x' + logs[0].topics[3].slice(-40)).toLowerCase();

  const supply = transfers.filter(t => t.from === zeroAddress).reduce((s, t) => s + t.value, 0n);
  if (supply === 0n) return undefined;
  const checkBlock = blockAt(firstAt), endBlock = blockAt(firstAt + RUG_HORIZON);

  // one pass over the log: balances and holder count kept up to date, peaks tracked after the check
  const bal = new Map<string, bigint>();
  let holders = 0, holdersAtCheck = -1, peakHolders = 0, depPeak = 0n;
  const counts = (a: string) => a !== zeroAddress && a !== DEAD;
  const move = (a: string, d: bigint) => {
    const before = bal.get(a) ?? 0n, after = before + d;
    bal.set(a, after);
    if (counts(a)) { if (before <= 0n && after > 0n) holders++; else if (before > 0n && after <= 0n) holders--; }
  };
  const afterCheck = () => {
    if (holdersAtCheck < 0) holdersAtCheck = holders;
    peakHolders = Math.max(peakHolders, holders);
    const d = bal.get(deployer) ?? 0n;
    if (d > depPeak) depPeak = d;
  };
  for (const t of transfers) {
    if (t.block > endBlock) break;
    if (t.block > checkBlock) afterCheck(); // the state just before this transfer is post-check
    const from = t.from.toLowerCase(), to = t.to.toLowerCase();
    if (from !== zeroAddress) move(from, -t.value);
    move(to, t.value);
    if (t.block > checkBlock) afterCheck();
  }
  afterCheck(); // also covers tokens with no transfers after the check
  const depEnd = bal.get(deployer) ?? 0n;

  const deployerPeakPct = Number((depPeak * 1_000_000n) / supply) / 10_000;
  const deployerSoldPct = depPeak > 0n ? Math.max(0, Number(((depPeak - depEnd) * 10_000n) / depPeak) / 100) : 0;
  const dumped = deployerPeakPct >= 0.5 && deployerSoldPct >= 90;
  const exodus = peakHolders >= 20 && holders <= peakHolders / 2;
  return {
    token, firstScore, firstAt, evaluatedAt: Date.now(), horizonHours: RUG_HORIZON / 3600_000,
    holdersAtCheck, peakHolders, holdersAtHorizon: holders, deployerPeakPct, deployerSoldPct,
    dumped, exodus, rug: dumped || exodus,
  };
}

export function startAccuracy() {
  const tick = () => evaluate().catch(err => console.error('accuracy run failed', (err as Error).message));
  setTimeout(tick, 2 * 60_000);
  setInterval(tick, 2 * 3600_000);
  const rugTick = () => evaluateRugs().catch(err => console.error('rug run failed', (err as Error).message));
  setTimeout(rugTick, 3 * 60_000);
  setInterval(rugTick, 15 * 60_000);
}

/** Holders at the first check that make a token "bought": most launches never get a second buyer. */
const TRACTION = 10;

export function rugSummary() {
  // most launches have nobody in them to rug, so the headline counts tokens people actually bought
  const all = rugs.values().filter(o => o.peakHolders >= TRACTION);
  const allTokens = rugs.values().length;
  const buckets = LEVELS.map(L => {
    const rows = all.filter(o => o.firstScore >= L.lo && o.firstScore <= L.hi);
    return {
      level: L.level, range: L.range, tokens: rows.length,
      rugPct: pct(rows.filter(o => o.rug).length, rows.length),
      deployerDumpPct: pct(rows.filter(o => o.dumped).length, rows.length),
      holderExodusPct: pct(rows.filter(o => o.exodus).length, rows.length),
    };
  });
  const low = buckets[0], high = buckets[3];
  return {
    updatedAt: rugLastRun || null,
    tokens: all.length,
    evaluated: allTokens,
    minHolders: TRACTION,
    buckets,
    // how many times more often high-risk tokens were rugged than low-risk ones
    lift: low.rugPct && high.rugPct !== null ? Math.round((high.rugPct / low.rugPct) * 10) / 10 : null,
    method: {
      rug: 'within 3 days after Tell first scored the token: the deployer sold 90% or more of the most they held after the check (if that was at least 0.5% of supply), or the token lost half of its peak holders (from at least 20)',
      window: 'every token is judged on the same clock: its state exactly 3 days after the first check, rebuilt from the on-chain transfer log',
      sample: `tokens that reached at least ${TRACTION} holders after the first check; launches nobody bought have nothing to rug`,
      excluded: 'anything that happened before the first check (Tell had already seen it), tokens not launched on Pons, tokens with more than 40,000 transfers',
    },
  };
}
export const rugRows = () => rugs.values();

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

export function accuracySummary() {
  const all = outcomes.values();
  const buckets = LEVELS.map(L => {
    const rows = all.filter(o => o.firstScore >= L.lo && o.firstScore <= L.hi);
    return {
      level: L.level, range: L.range, tokens: rows.length,
      reachedPoolPct: pct(rows.filter(o => o.pool).length, rows.length),
      alivePct: pct(rows.filter(o => o.alive).length, rows.length),
      deadPct: pct(rows.filter(o => !o.alive).length, rows.length),
      medianLiquidityOfAliveUsd: median(rows.filter(o => o.alive).map(o => o.liquidityUsd)),
    };
  });
  const low = buckets[0], high = buckets[3];
  return {
    updatedAt: lastRun || null,
    tokens: all.length,
    from: all.length ? Math.min(...all.map(o => o.firstAt)) : null,
    to: all.length ? Math.max(...all.map(o => o.firstAt)) : null,
    buckets,
    lift: low.alivePct !== null && high.alivePct ? Math.round((low.alivePct / high.alivePct) * 10) / 10 : null,
    method: {
      outcomeWindow: 'each token is looked at once, 2 to 7 days after its first check, and the result is frozen',
      alive: `has a DEX pool with at least $${ALIVE_USD.toLocaleString('en-US')} of liquidity at that moment`,
      score: 'the first score Tell gave the token, before anyone knew the outcome',
      source: 'DexScreener API for pools and liquidity; Tell score history for scores',
      excluded: 'stablecoins, WETH and tokenized stocks Tell recognizes',
    },
    caveats: [
      'Survival is not safety: a token can be alive and still be a bad buy, or die without any wrongdoing.',
      'Most launches on any launchpad never reach a pool, so even "low risk" has a high death rate. Compare levels with each other, not with zero.',
      'The checks improve over time; old scores were made by older versions of Tell.',
      'Tell checked these tokens on its own; launches it never got to are not in the sample.',
    ],
  };
}

export const accuracyRows = () => outcomes.values();

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
