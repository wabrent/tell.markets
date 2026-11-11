// Renders what the bots would post, without sending anything.  npx tsx scripts/bots-test.ts
import { digestText } from '../src/bots/x.js';
import { card } from '../src/bots/telegram.js';
import { quickCheck } from '../src/quick.js';
import { leafOf, merkleProof, merkleRoot } from '../src/proof.js';
import { concat, keccak256, type Hex } from 'viem';

const a = await quickCheck('0x45C83b37C5BAF4dad26f3845C28295e2DE010962');
console.log('--- telegram card ---\n' + card(a.report, 'https://tell.markets', a.mode));
const d = digestText('https://tell.markets');
console.log(`--- x digest (${d.length} chars) ---\n${d}`);

// Merkle self-check: every leaf's proof folds back to the root
const leaves = Array.from({ length: 7 }, (_, i) => leafOf({ ...a.report, verdict: 'v' + i }, 1000 + i));
const root = merkleRoot(leaves);
const pair = (x: Hex, y: Hex) => keccak256(x.toLowerCase() < y.toLowerCase() ? concat([x, y]) : concat([y, x]));
const okAll = leaves.every(l => merkleProof(leaves, l).reduce(pair, l) === root);
console.log('--- merkle ---\n7 leaves, every proof folds to root:', okAll);
process.exit(okAll ? 0 : 1);
