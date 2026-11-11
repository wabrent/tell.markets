import { concat, createWalletClient, erc20Abi, encodeAbiParameters, http, keccak256, stringToHex, toHex, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Report } from './analyze.js';
import { config } from './config.js';
import { events } from './events.js';
import { client, robinhoodChain } from './sources/rpc.js';
import { JsonStore } from './store.js';

/*
 * Verdict ledger. Every finished check becomes a leaf: hash(token, score, verdict, checks, time).
 * Once an hour the leaves are folded into a Merkle root and the root is written to Robinhood
 * Chain as the data of a 0-value transaction ("TELL" + root) from the proof wallet to itself.
 * Anyone can then prove a verdict existed at that time and was not edited afterwards.
 */

interface Leaf { token: string; symbol?: string; score: number; label: string; at: number; leaf: Hex; batch?: string }
interface Batch { id: string; closedAt: number; count: number; root: Hex; leaves: Hex[]; tx?: Hex; anchoredAt?: number; error?: string }

const leaves = new JsonStore<Leaf>('proof-leaves.json', 200_000);
const batches = new JsonStore<Batch>('proof-batches.json', 20_000);
const MARK = stringToHex('TELL'); // 0x54454c4c

export function leafOf(r: Report, at: number): Hex {
  const checks = keccak256(stringToHex(JSON.stringify(r.checks.map(c => [c.group, c.status, c.title, c.risk]))));
  return keccak256(encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint8' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint64' }],
    [r.token.address, r.score.value, keccak256(stringToHex(r.verdict)), checks, BigInt(at)],
  ));
}

const pair = (a: Hex, b: Hex) => keccak256(a.toLowerCase() < b.toLowerCase() ? concat([a, b]) : concat([b, a]));

/** Root of a list of leaves; pairs are hashed sorted, an odd node moves up unchanged. */
export function merkleRoot(list: Hex[]): Hex {
  if (!list.length) return toHex(0n, { size: 32 });
  let level = list;
  while (level.length > 1) {
    const next: Hex[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? pair(level[i], level[i + 1]) : level[i]);
    level = next;
  }
  return level[0];
}

export function merkleProof(list: Hex[], leaf: Hex): Hex[] {
  let idx = list.indexOf(leaf);
  if (idx < 0) return [];
  const proof: Hex[] = [];
  let level = list;
  while (level.length > 1) {
    const sib = idx ^ 1;
    if (sib < level.length) proof.push(level[sib]);
    const next: Hex[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? pair(level[i], level[i + 1]) : level[i]);
    idx = Math.floor(idx / 2);
    level = next;
  }
  return proof;
}

export function startProofLedger() {
  events.on('report', (r, at) => {
    const leaf = leafOf(r, at);
    leaves.set(`${r.token.address.toLowerCase()}:${at}`, { token: r.token.address.toLowerCase(), symbol: r.token.symbol, score: r.score.value, label: r.score.label, at, leaf });
  });
  const tick = () => closeBatch().catch(err => console.error('proof batch failed', (err as Error).message));
  // first close a minute after start (picks up anything left from before a restart), then hourly
  setTimeout(tick, 60_000);
  setInterval(tick, 3600_000);
}

async function closeBatch() {
  // batches closed while the wallet had no gas get anchored as soon as it has some
  if (config.proofKey) for (const b of batches.values().filter(b => !b.tx).slice(-24)) await anchor(b);
  const open = leaves.entries().filter(([, l]) => !l.batch);
  if (!open.length) return;
  const id = new Date().toISOString().slice(0, 13) + 'h';
  const list = open.map(([, l]) => l.leaf);
  const batch: Batch = { id, closedAt: Date.now(), count: list.length, root: merkleRoot(list), leaves: list };
  for (const [k, l] of open) leaves.set(k, { ...l, batch: id });
  batches.set(id, batch);
  if (config.proofKey) await anchor(batch);
}

let wallet: ReturnType<typeof createWalletClient> | undefined;

async function anchor(b: Batch) {
  try {
    wallet ??= createWalletClient({ account: privateKeyToAccount(config.proofKey as Hex), chain: robinhoodChain, transport: http(config.rpcUrl) });
    const account = wallet.account!;
    if (await client.getBalance({ address: account.address }) === 0n) {
      batches.set(b.id, { ...b, error: 'waiting for gas: the anchor wallet has no ETH yet' });
      return;
    }
    const tx = await wallet.sendTransaction({ account, chain: robinhoodChain, to: account.address, value: 0n, data: concat([MARK, b.root]) });
    await client.waitForTransactionReceipt({ hash: tx, timeout: 60_000 });
    batches.set(b.id, { ...b, tx, anchoredAt: Date.now(), error: undefined });
  } catch (err) {
    batches.set(b.id, { ...b, error: (err as Error).message.split('\n')[0].slice(0, 160) });
  }
}

/** $TELL sitting at the dead address: the running total of buyback-and-burn. */
export async function tellBurned(): Promise<{ token: string; burned: number } | null> {
  if (!config.tellToken) return null;
  try {
    const t = config.tellToken as Hex;
    const [raw, decimals] = await Promise.all([
      client.readContract({ address: t, abi: erc20Abi, functionName: 'balanceOf', args: ['0x000000000000000000000000000000000000dEaD'] }),
      client.readContract({ address: t, abi: erc20Abi, functionName: 'decimals' }),
    ]);
    return { token: t, burned: Number(raw / 10n ** BigInt(decimals)) };
  } catch { return null; }
}

export function proofAddress(): string | undefined {
  try { return config.proofKey ? privateKeyToAccount(config.proofKey as Hex).address : undefined; } catch { return undefined; }
}

export function proofSummary() {
  const all = batches.values().sort((a, b) => b.closedAt - a.closedAt);
  return {
    anchoring: Boolean(config.proofKey),
    anchorAddress: proofAddress() ?? null,
    format: 'tx.data = "TELL" (0x54454c4c) + merkle root; leaf = keccak256(abi.encode(address token, uint8 score, bytes32 keccak(verdict), bytes32 keccak(checks), uint64 checkedAtMs)); pairs hashed sorted',
    verdicts: leaves.values().length,
    pending: leaves.values().filter(l => !l.batch).length,
    batches: all.slice(0, 100).map(b => ({ id: b.id, closedAt: b.closedAt, count: b.count, root: b.root, tx: b.tx ?? null, error: b.error ?? null })),
  };
}

/** Every recorded verdict for a token, each with the proof that it is in its batch root. */
export function proofFor(token: string) {
  const mine = leaves.values().filter(l => l.token === token.toLowerCase()).sort((a, b) => b.at - a.at).slice(0, 20);
  return mine.map(l => {
    const b = l.batch ? batches.get(l.batch) : undefined;
    return { at: l.at, score: l.score, label: l.label, leaf: l.leaf, batch: l.batch ?? null, root: b?.root ?? null, tx: b?.tx ?? null, proof: b ? merkleProof(b.leaves, l.leaf) : [] };
  });
}
