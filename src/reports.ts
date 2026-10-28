import { analyze, type Report } from './analyze.js';
import { background } from './sources/rpc.js';
import { JsonStore } from './store.js';

const CACHE_MS = 10 * 60_000;
const DEGRADED_MS = 60_000;

// Reports survive restarts; the score history is what lets a report show how risk moved.
const cache = new JsonStore<{ at: number; report: Report }>('reports.json', 400);
const history = new JsonStore<{ t: number; s: number }[]>('history.json', 5000);
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
        cache.set(key, { at: Date.now(), report });
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
export const isChecking = (address: string) => inflight.has(address.toLowerCase());
