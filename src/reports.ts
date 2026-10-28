import { analyze, type Report } from './analyze.js';
import { JsonStore } from './store.js';

const CACHE_MS = 10 * 60_000;

// Reports survive restarts; the score history is what lets a report show how risk moved.
const cache = new JsonStore<{ at: number; report: Report }>('reports.json', 400);
const history = new JsonStore<{ t: number; s: number }[]>('history.json', 5000);
const inflight = new Map<string, Promise<Report>>();

export interface Point { t: number; s: number }

/** A fresh-enough report for this token, running one check at most per token at a time. */
export async function getReport(address: `0x${string}`, opts: { maxAge?: number } = {}): Promise<Report> {
  const key = address.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (opts.maxAge ?? CACHE_MS)) return hit.report;

  let p = inflight.get(key);
  if (!p) {
    p = analyze(address).then(report => {
      cache.set(key, { at: Date.now(), report });
      const h = history.get(key) ?? [];
      const last = h[h.length - 1];
      // one point per 10 minutes is plenty for a sparkline
      if (!last || Date.now() - last.t > CACHE_MS || last.s !== report.score.value) {
        history.set(key, [...h, { t: Date.now(), s: report.score.value }].slice(-200));
      }
      return report;
    }).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

/** Whatever we have on file, however old. Used by lists that must not trigger checks. */
export const cachedReport = (address: string) => cache.get(address.toLowerCase());
export const scoreHistory = (address: string): Point[] => history.get(address.toLowerCase()) ?? [];
export const isChecking = (address: string) => inflight.has(address.toLowerCase());
