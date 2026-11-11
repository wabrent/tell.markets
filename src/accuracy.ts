import { knownAsset } from './known.js';
import { firstScores } from './reports.js';
import { getTokensPairs } from './sources/dexscreener.js';
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
  { level: 'low', range: '0–29', lo: 0, hi: 29 },
  { level: 'medium', range: '30–59', lo: 30, hi: 59 },
  { level: 'caution', range: '60–79', lo: 60, hi: 79 },
  { level: 'high', range: '80–100', lo: 80, hi: 100 },
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

export function startAccuracy() {
  const tick = () => evaluate().catch(err => console.error('accuracy run failed', (err as Error).message));
  setTimeout(tick, 2 * 60_000);
  setInterval(tick, 2 * 3600_000);
}

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
