import { analyze, type Report } from './analyze.js';
import { events } from './events.js';
import { background } from './sources/rpc.js';
import { JsonStore } from './store.js';

const CACHE_MS = 10 * 60_000;
const DEGRADED_MS = 60_000;

// Reports survive restarts; the score history is what lets a report show how risk moved.
const cache = new JsonStore<{ at: number; report: Report }>('reports.json', 400);
// ~1,600 Pons launches a day: room for about a month, which the accuracy tracker needs
const history = new JsonStore<{ t: number; s: number }[]>('history.json', 50_000);
const inflight = new Map<string, Promise<Report>>();
let userChecks = 0;

export interface Point { t: number; s: number }

/** A fresh-enough report for this token, running one check at most per token at a time. */
export async function getReport(address: `0x${string}`, opts: { maxAge?: number } = {}): Promise<Report> {
  const key = address.toLowerCase();
  const hit = cache.get(key);
  const maxAge = hit?.report.degraded ? DEGRADED_MS : opts.maxAge ?? CACHE_MS;
  if (hit && Date.now() - hit.at < maxAge) return hit.report;

  const fromUser = !background.getStore();
  if (fromUser) userChecks++;
  try {
    let p = inflight.get(key);
    if (!p) {
      p = analyze(address).then(report => {
        const at = Date.now();
        cache.set(key, { at, report });
        if (!report.degraded) {
          try { events.emit('report', report, at); } catch (err) { console.error('report listener failed', err); }
        }
        // a half-loaded report says nothing about how risk moved
        if (!report.degraded) {
          const h = history.get(key) ?? [];
          const last = h[h.length - 1];
          if (!last || Date.now() - last.t > CACHE_MS || last.s !== report.score.value) {
            history.set(key, [...h, { t: Date.now(), s: report.score.value }].slice(-200));
          }
        }
        return report;
      }).finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    return await p;
  } finally {
    if (fromUser) userChecks--;
  }
}

/** True while someone is waiting on a check; the launch feed holds off until it's done. */
export const userBusy = () => userChecks > 0;

/** Whatever we have on file, however old. Used by lists that must not trigger checks. */
export const cachedReport = (address: string) => cache.get(address.toLowerCase());
export const scoreHistory = (address: string): Point[] => history.get(address.toLowerCase()) ?? [];
/** How long recent full checks took, in ms, for the live stats strip. */
export const recentCheckMs = () => cache.values().filter(c => !c.report.degraded && Date.now() - c.at < 24 * 3600_000).map(c => c.report.ms);
/** First recorded score of every token, for the accuracy tracker. */
export const firstScores = () => history.entries().map(([token, h]) => ({ token, ...h[0] })).filter(f => f.t);
export const isChecking = (address: string) => inflight.has(address.toLowerCase());
