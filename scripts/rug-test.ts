// Runs the rug check on Pons launches from 4-5 days ago, as if Tell first scored each one
// 10 minutes after its launch (which is how the launch feed works).
//   npx tsx scripts/rug-test.ts [count]
import { rugOutcome } from '../src/accuracy.js';
import { BLOCKS_PER_SEC, LAUNCH_TOPIC, PONS_FACTORY } from '../src/launches.js';
import { client } from '../src/sources/rpc.js';
import type { Hex } from 'viem';

const count = Number(process.argv[2] ?? 40);
const latest = await client.getBlock();
const nowMs = Number(latest.timestamp) * 1000;
const blockAt = (t: number) => latest.number - BigInt(Math.max(0, Math.round((nowMs - t) / 1000 * BLOCKS_PER_SEC)));
const timeOf = (b: bigint) => nowMs - Number(latest.number - b) / BLOCKS_PER_SEC * 1000;
const from = blockAt(Date.now() - 5 * 24 * 3600_000);
const logs = await client.request({ method: 'eth_getLogs', params: [{ address: PONS_FACTORY, topics: [LAUNCH_TOPIC], fromBlock: `0x${from.toString(16)}`, toBlock: `0x${(from + 400_000n).toString(16)}` }] }) as { topics: Hex[]; blockNumber: Hex }[];
console.log(`${logs.length} launches in a ~11h window 5 days ago; testing ${Math.min(count, logs.length)}`);
let judged = 0, traction = 0, rugs = 0;
for (const l of logs.slice(0, count)) {
  const token = ('0x' + l.topics[1].slice(-40)) as Hex;
  const firstAt = timeOf(BigInt(l.blockNumber)) + 10 * 60_000;
  const o = await rugOutcome(token, 40, firstAt, blockAt).catch(e => { console.log(token, 'ERR', e.message.split('\n')[0]); return null; });
  if (!o) continue;
  judged++;
  if (o.peakHolders < 10) continue;
  traction++; if (o.rug) rugs++;
  console.log(`${token} holders ${o.holdersAtCheck}→peak ${o.peakHolders}→${o.holdersAtHorizon} | dev peak ${o.deployerPeakPct}% sold ${o.deployerSoldPct}% | ${o.rug ? 'RUG' + (o.dumped ? ' (dump)' : '') + (o.exodus ? ' (exodus)' : '') : 'ok'}`);
}
console.log(`judged ${judged}, reached 10+ holders ${traction}, rugged ${rugs}`);
process.exit(0);
