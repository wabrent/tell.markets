import { createPublicClient, defineChain, http } from 'viem';
import { config } from '../config.js';

export const robinhoodChain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
});

export const client = createPublicClient({
  chain: robinhoodChain,
  // batch: many small calls (getCode for top holders etc.) go out as one HTTP request, which keeps
  // us under the public RPC's rate limit
  transport: http(config.rpcUrl, { retryCount: 2, timeout: 20_000, batch: { batchSize: 50, wait: 10 } }),
});

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
export const errText = (e: any) => String(e?.details ?? e?.shortMessage ?? e?.message ?? e);

/** Retries rate-limit errors with backoff; anything else is thrown to the caller. */
export async function withBackoff<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt < 6 && /too many requests|429|rate/i.test(errText(e))) {
        await sleep(300 * 2 ** attempt + Math.random() * 200);
        continue;
      }
      throw e;
    }
  }
}
