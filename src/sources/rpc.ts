import { AsyncLocalStorage } from 'node:async_hooks';
import { createPublicClient, defineChain, http } from 'viem';
import { config } from '../config.js';

export const robinhoodChain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
});

/*
 * One gate for every RPC request the server makes. The public RPC answers bursts with 429, and a
 * check that loses those races ends up with half its data, so requests are spaced out here
 * instead of hoping retries catch up. Work started by the background launch feed runs in the
 * `background` context and always waits behind checks a person asked for.
 */
export const background = new AsyncLocalStorage<boolean>();
const MAX_INFLIGHT = 4;
const MIN_GAP_MS = 45;
const queues: { fg: (() => void)[]; bg: (() => void)[] } = { fg: [], bg: [] };
let inflight = 0;
let lastStart = 0;
let pumping = false;

function pump() {
  if (pumping) return;
  pumping = true;
  const step = () => {
    while (inflight < MAX_INFLIGHT && (queues.fg.length || queues.bg.length)) {
      const wait = lastStart + MIN_GAP_MS - Date.now();
      if (wait > 0) { setTimeout(step, wait); return; }
      lastStart = Date.now();
      inflight++;
      (queues.fg.shift() ?? queues.bg.shift())!();
    }
    pumping = false;
  };
  step();
}

const gatedFetch: typeof fetch = async (input, init) => {
  await new Promise<void>(go => { (background.getStore() ? queues.bg : queues.fg).push(go); pump(); });
  try {
    return await fetch(input, init);
  } finally {
    inflight--;
    pump();
  }
};

/** True while any person-initiated RPC work is waiting or running. */
export const foregroundBusy = () => queues.fg.length > 0;

export const client = createPublicClient({
  chain: robinhoodChain,
  // batch: many small calls (getCode for top holders etc.) go out as one HTTP request
  transport: http(config.rpcUrl, { retryCount: 2, timeout: 25_000, batch: { batchSize: 50, wait: 10 }, fetchFn: gatedFetch }),
});

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
export const errText = (e: any) => String(e?.details ?? e?.shortMessage ?? e?.message ?? e);
export const isRateLimit = (e: unknown) => /too many requests|429|rate limit/i.test(errText(e));

/** Retries rate-limit errors with backoff; anything else is thrown to the caller. */
export async function withBackoff<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt < 8 && isRateLimit(e)) {
        await sleep(Math.min(400 * 2 ** attempt, 8000) + Math.random() * 300);
        continue;
      }
      throw e;
    }
  }
}
