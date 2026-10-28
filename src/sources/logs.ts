import { parseAbiItem, type Hex } from 'viem';
import { client, errText, withBackoff } from './rpc.js';

// The public RPC caps a getLogs call at 10M blocks and 10k results, and rate-limits bursts.
const MAX_SPAN = 10_000_000n;
const CONCURRENCY = 3;

const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

export interface Transfer {
  from: Hex;
  to: Hex;
  value: bigint;
  block: bigint;
  tx: Hex;
  logIndex: number;
}

class TooMany extends Error {}

/** Splits [from, to] into ≤10M-block ranges, newest first. */
function ranges(from: bigint, to: bigint) {
  const out: [bigint, bigint][] = [];
  for (let hi = to; hi >= from; hi -= MAX_SPAN) {
    const lo = hi - MAX_SPAN + 1n > from ? hi - MAX_SPAN + 1n : from;
    out.push([lo, hi]);
    if (lo === from) break;
  }
  return out;
}

/** Runs tasks with a small concurrency cap. */
async function pool<T>(tasks: (() => Promise<T>)[], n = CONCURRENCY): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]();
    }
  }));
  return out;
}

/**
 * Every Transfer of a token since genesis, oldest first. Gives up (complete: false) past
 * `maxLogs`, which only happens for old, busy tokens — not the new launches Tell is for.
 */
export async function fetchTransfers(token: Hex, maxLogs = 40_000): Promise<{ transfers: Transfer[]; complete: boolean }> {
  const latest = await client.getBlockNumber();
  let total = 0;

  const getRange = async (lo: bigint, hi: bigint): Promise<Transfer[]> => {
    if (total > maxLogs) throw new TooMany();
    try {
      const logs = await withBackoff(() => client.getLogs({ address: token, event: transferEvent, fromBlock: lo, toBlock: hi }));
      total += logs.length;
      return logs.map(l => ({
        from: l.args.from!, to: l.args.to!, value: l.args.value!,
        block: l.blockNumber, tx: l.transactionHash, logIndex: l.logIndex,
      }));
    } catch (e) {
      if (e instanceof TooMany) throw e;
      // more than 10k logs in this range: halve it
      if (/exceeds limit|too many results|query returned more/i.test(errText(e)) && hi > lo) {
        const mid = (lo + hi) / 2n;
        return [...(await getRange(lo, mid)), ...(await getRange(mid + 1n, hi))];
      }
      throw e;
    }
  };

  try {
    const parts = await pool(ranges(0n, latest).map(([lo, hi]) => () => getRange(lo, hi)));
    const transfers = parts.flat().sort((a, b) => (a.block === b.block ? a.logIndex - b.logIndex : a.block < b.block ? -1 : 1));
    return { transfers, complete: true };
  } catch (e) {
    if (e instanceof TooMany) return { transfers: [], complete: false };
    throw e;
  }
}

/** Raw logs of one event from one contract, filtered by topics, across the whole chain. */
export async function fetchEventLogs(address: Hex, topics: (Hex | null)[]) {
  const latest = await client.getBlockNumber();
  const parts = await pool(ranges(0n, latest).map(([lo, hi]) => () =>
    withBackoff(() => client.request({
      method: 'eth_getLogs',
      params: [{ address, topics, fromBlock: `0x${lo.toString(16)}`, toBlock: `0x${hi.toString(16)}` }],
    })),
  ));
  return parts.flat() as { topics: Hex[]; data: Hex; transactionHash: Hex; blockNumber: Hex }[];
}

