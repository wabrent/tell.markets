import { applyIdentity, verdict, type Report } from './analyze.js';
import { checkContract, readToken } from './checks/contract.js';
import { checkMarket, checkSocials } from './checks/market.js';
import type { Check } from './checks/types.js';
import { cachedReport, getReport, isChecking } from './reports.js';
import { score } from './scoring.js';
import { getTokenPairs, type DexPair } from './sources/dexscreener.js';
import { background } from './sources/rpc.js';

/** A full report this old still answers a quick check. */
const QUICK_FROM_CACHE_MS = 3600_000;

export interface Answer {
  report: Report;
  at: number;
  /** 'full' = every check incl. holders, deployer and AI; 'quick' = contract + market only. */
  mode: 'full' | 'quick';
}

/**
 * The answer an agent can wait for: a recent full report if there is one, otherwise the contract
 * and market checks only (a few RPC calls, no transfer history, no AI). A quick answer also queues
 * the full check in the background, so asking again a minute later returns the whole picture.
 */
export async function quickCheck(address: `0x${string}`): Promise<Answer> {
  const c = cachedReport(address);
  if (c && !c.report.degraded && Date.now() - c.at < QUICK_FROM_CACHE_MS) return { report: c.report, at: c.at, mode: 'full' };

  const started = Date.now();
  const [token, pairs] = await Promise.all([readToken(address), getTokenPairs(address).catch(() => [] as DexPair[])]);
  const own = pairs.filter(p => p.baseToken.address.toLowerCase() === address.toLowerCase());
  // Tokens still on a bonding curve carry their links in the launch transaction, which only the
  // full check reads; saying "no website" here would be wrong for them.
  const checks: Check[] = [
    ...await checkContract(token), ...checkMarket(own),
    ...(own.length ? checkSocials(own) : [{ group: 'website' as const, status: 'info' as const, title: 'Website and socials: in the full check', risk: 0 }]),
  ];
  applyIdentity(token, checks);

  if (!isChecking(address)) {
    background.run(true, () => getReport(address)).catch(err => console.error('background full check failed', address, err?.message ?? err));
  }
  const report: Report = {
    token, pairs: own, checks, facts: {}, score: score(checks), verdict: verdict(checks), aiVerdict: false, ms: Date.now() - started,
  };
  return { report, at: Date.now(), mode: 'quick' };
}

export async function fullCheck(address: `0x${string}`): Promise<Answer> {
  const report = await getReport(address);
  return { report, at: cachedReport(address)?.at ?? Date.now(), mode: 'full' };
}
