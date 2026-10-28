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
 * Every Transfer of a token since genesis, oldest first. Past `maxLogs` (old, busy tokens) it
 * stops reaching further back and returns the most recent `maxLogs` with complete: false, which is
 * still enough to draw a map of recent activity.
 */
export async function fetchTransfers(token: Hex, maxLogs = 40_000): Promise<{ transfers: Transfer[]; complete: boolean }> {
  const latest = await withBackoff(() => client.getBlockNumber());
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
      // newer half first, so when the cap hits we have kept the recent activity
      if (/exceeds limit|too many results|query returned more/i.test(errText(e)) && hi > lo) {
        const mid = (lo + hi) / 2n;
        const newer = await getRange(mid + 1n, hi);
        const older = await getRange(lo, mid).catch(err => { if (err instanceof TooMany) return []; throw err; });
        return [...older, ...newer];
      }
      throw e;
    }
  };

  // ranges run newest first; once the cap is hit, older ranges come back empty instead of failing
  const parts = await pool(ranges(0n, latest).map(([lo, hi]) => () =>
    getRange(lo, hi).catch(err => { if (err instanceof TooMany) return [] as Transfer[]; throw err; })));
  const sorted = parts.flat().sort((a, b) => (a.block === b.block ? a.logIndex - b.logIndex : a.block < b.block ? -1 : 1));
  const complete = total <= maxLogs;
  return { transfers: complete ? sorted : sorted.slice(-maxLogs), complete };
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

