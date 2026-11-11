// Runs the rug check on recent Pons launches as if Tell had first scored them `hoursAgo` hours ago.
//   npx tsx scripts/rug-test.ts [count] [hoursAgo]
import { rugOutcome } from '../src/accuracy.js';
import { BLOCKS_PER_SEC, LAUNCH_TOPIC, PONS_FACTORY } from '../src/launches.js';
import { client } from '../src/sources/rpc.js';
import type { Hex } from 'viem';

const count = Number(process.argv[2] ?? 12), hoursAgo = Number(process.argv[3] ?? 30);
const latest = await client.getBlock();
const blockAt = (t: number) => latest.number - BigInt(Math.max(0, Math.round((Number(latest.timestamp) * 1000 - t) / 1000 * BLOCKS_PER_SEC)));
// launches from 2-3 days ago, first "checked" a couple of hours after launch
const from = blockAt(Date.now() - 72 * 3600_000), to = blockAt(Date.now() - 48 * 3600_000);
const logs = await client.request({ method: 'eth_getLogs', params: [{ address: PONS_FACTORY, topics: [LAUNCH_TOPIC], fromBlock: `0x${from.toString(16)}`, toBlock: `0x${(from + 20_000n < to ? from + 20_000n : to).toString(16)}` }] }) as { topics: Hex[] }[];
const given = process.argv.slice(4).filter(a => /^0x[0-9a-fA-F]{40}$/.test(a)) as Hex[];
const list = given.length ? given : logs.slice(0, count).map(l => ('0x' + l.topics[1].slice(-40)) as Hex);
console.log(given.length ? `testing ${given.length} given tokens` : `${logs.length} launches in range; testing ${list.length}`);
let rugs = 0, judged = 0;
for (const token of list) {
  const t0 = Date.now();
  const o = await rugOutcome(token, 40, Date.now() - hoursAgo * 3600_000, blockAt).catch(e => { console.log(token, 'ERR', e.message.split('\n')[0]); return null; });
  if (o === null) continue;
  if (!o) { console.log(token, 'skipped'); continue; }
  judged++; if (o.rug) rugs++;
  console.log(`${token} held ${o.deployerHeldPct}% sold ${o.deployerSoldPct}% holders ${o.holdersAt}->${o.holdersNow} ${o.rug ? 'RUG' : 'ok'} ${o.dumped ? '(dump)' : ''}${o.exodus ? '(exodus)' : ''} ${Date.now() - t0}ms`);
}
console.log(`judged ${judged}, rugs ${rugs}`);
process.exit(0);
