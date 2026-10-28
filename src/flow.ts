import { zeroAddress } from 'viem';
import { KNOWN, type HolderFacts } from './checks/holders.js';
import type { TokenInfo } from './checks/types.js';
import type { DexPair } from './sources/dexscreener.js';
import type { Transfer } from './sources/logs.js';

export type NodeKind = 'mint' | 'burn' | 'pool' | 'contract' | 'deployer' | 'wallet' | 'others';

export interface FlowNode {
  id: string;
  label: string;
  kind: NodeKind;
  /** Current balance, % of supply. */
  balance: number;
  /** The larger of everything received and everything sent, % of supply. */
  volume: number;
  cluster?: number;
  sniper?: boolean;
  /** Addresses folded into the "others" node. */
  members?: number;
}

export interface FlowGraph {
  nodes: FlowNode[];
  /** Aggregated transfers: [source index, target index, % of supply, count]. */
  edges: [number, number, number, number][];
  /** Transfers in order: [blocks since launch, source, target, % of supply]. Sampled when long. */
  events: [number, number, number, number][];
  totalEvents: number;
  firstBlock: string;
  lastBlock: string;
}

const MAX_NODES = 80;
const MAX_EVENTS = 3000;
const DEAD = '0x000000000000000000000000000000000000dead';

export function buildFlow(
  token: TokenInfo, transfers: Transfer[], holders: HolderFacts, deployer: string | undefined, pairs: DexPair[],
): FlowGraph | undefined {
  if (!transfers.length) return undefined;
  const supply = token.totalSupply && token.totalSupply > 0n ? token.totalSupply : 1n;
  const pct = (v: bigint) => Number((v * 1_000_000n) / supply) / 10_000;

  // max(in, out) rather than in + out, so a wallet that passes 10% straight through shows 10%
  const inflow = new Map<string, bigint>(), outflow = new Map<string, bigint>();
  for (const t of transfers) {
    const f = t.from.toLowerCase(), d = t.to.toLowerCase();
    outflow.set(f, (outflow.get(f) ?? 0n) + t.value);
    inflow.set(d, (inflow.get(d) ?? 0n) + t.value);
  }
  const volume = new Map<string, bigint>();
  for (const a of new Set([...inflow.keys(), ...outflow.keys()])) {
    const i = inflow.get(a) ?? 0n, o = outflow.get(a) ?? 0n;
    volume.set(a, i > o ? i : o);
  }
  const bal = (a: string) => holders.balances.get(a) ?? 0n;
  const byBalance = (a: string, b: string) => (bal(b) > bal(a) ? 1 : bal(b) < bal(a) ? -1 : 0);
  const byVolume = (a: string, b: string) => ((volume.get(b) ?? 0n) > (volume.get(a) ?? 0n) ? 1 : -1);
  const all = [...volume.keys()].filter(a => a !== zeroAddress && a !== DEAD);
  const pools = new Set(pairs.map(p => p.pairAddress.toLowerCase()));

  // Pick who gets their own dot: the infrastructure, the deployer, the biggest holders,
  // the suspicious ones, and the busiest traders. Everyone else becomes "other wallets".
  const picked: string[] = [];
  const add = (a: string | undefined) => { if (a && !picked.includes(a) && picked.length < MAX_NODES) picked.push(a); };
  if (volume.has(zeroAddress)) add(zeroAddress);
  if (volume.has(DEAD)) add(DEAD);
  all.filter(a => holders.contracts.has(a)).sort(byVolume).slice(0, 10).forEach(add);
  add(deployer?.toLowerCase());
  all.filter(a => !holders.contracts.has(a)).sort(byBalance).slice(0, 35).forEach(add);
  [...holders.clusterOf.keys()].sort(byBalance).slice(0, 18).forEach(add);
  [...holders.snipers].sort(byVolume).slice(0, 8).forEach(add);
  all.filter(a => !holders.contracts.has(a)).sort(byVolume).slice(0, 15).forEach(add);

  const index = new Map(picked.map((a, i) => [a, i]));
  const othersIdx = picked.length;
  const idx = (a: string) => index.get(a) ?? othersIdx;

  const nodes: FlowNode[] = picked.map(a => {
    const kind: NodeKind =
      a === zeroAddress ? 'mint'
      : a === DEAD ? 'burn'
      : a === deployer?.toLowerCase() ? 'deployer'
      : KNOWN[a]?.includes('PoolManager') || pools.has(a) ? 'pool'
      : holders.contracts.has(a) ? 'contract'
      : 'wallet';
    const label =
      kind === 'mint' ? 'Mint' : kind === 'burn' ? 'Burn' : kind === 'deployer' ? 'Deployer'
      : KNOWN[a] ?? (kind === 'pool' ? 'DEX pool' : kind === 'contract' ? 'Contract' : `${a.slice(0, 6)}…${a.slice(-4)}`);
    return {
      id: a, label, kind,
      balance: kind === 'mint' ? 0 : pct(bal(a) > 0n ? bal(a) : 0n),
      volume: pct(volume.get(a) ?? 0n),
      cluster: holders.clusterOf.get(a),
      sniper: holders.snipers.has(a) || undefined,
    };
  });
  const rest = all.filter(a => !index.has(a));
  nodes.push({
    id: 'others', label: `${rest.length.toLocaleString('en-US')} other wallets`, kind: 'others',
    balance: pct(rest.reduce((s, a) => s + (bal(a) > 0n ? bal(a) : 0n), 0n)),
    volume: pct(rest.reduce((s, a) => s + (volume.get(a) ?? 0n), 0n)),
    members: rest.length,
  });

  const agg = new Map<string, [number, number, bigint, number]>();
  const first = transfers[0].block;
  const allEvents: [number, number, number, number][] = [];
  for (const t of transfers) {
    const s = idx(t.from.toLowerCase()), d = idx(t.to.toLowerCase());
    if (s === d) continue; // others -> others is noise on a map
    const key = `${s}>${d}`;
    const e = agg.get(key) ?? [s, d, 0n, 0];
    e[2] += t.value; e[3] += 1;
    agg.set(key, e);
    allEvents.push([Number(t.block - first), s, d, pct(t.value)]);
  }

  // Keep the launch in full detail, then sample evenly so the replay stays smooth.
  let events = allEvents;
  if (allEvents.length > MAX_EVENTS) {
    const head = allEvents.slice(0, 400);
    const tail = allEvents.slice(400);
    const step = tail.length / (MAX_EVENTS - 400);
    events = [...head, ...Array.from({ length: MAX_EVENTS - 400 }, (_, i) => tail[Math.floor(i * step)])];
  }

  return {
    nodes,
    edges: [...agg.values()].map(([s, d, v, n]) => [s, d, pct(v), n]),
    events,
    totalEvents: allEvents.length,
    firstBlock: first.toString(),
    lastBlock: transfers[transfers.length - 1].block.toString(),
  };
}
