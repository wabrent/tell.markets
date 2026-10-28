import { zeroAddress, type Hex } from 'viem';
import { client, withBackoff } from '../sources/rpc.js';
import type { Transfer } from '../sources/logs.js';
import { short } from './contract.js';
import type { Check, TokenInfo } from './types.js';

const BURN = new Set([zeroAddress, '0x000000000000000000000000000000000000dead'].map(a => a.toLowerCase()));

// Contracts that hold supply on behalf of everyone: excluding them is what makes the
// concentration numbers mean "how much do individual wallets hold".
export const KNOWN: Record<string, string> = {
  '0x8366a39cc670b4001a1121b8f6a443a643e40951': 'Uniswap v4 PoolManager',
  '0x267444d099b10fb5ed7c3cc7b7c767adca574952': 'Pons locker',
  '0xe5e702641ea86f4ae6cc3cdaed2b886f976be044': 'Pons hook',
};

export interface HolderFacts {
  holders: number;
  /** Lowercased addresses that are contracts (pools, curves, lockers). */
  contracts: Set<string>;
  balances: Map<string, bigint>;
  /** Wallet -> cluster number, for wallets seeded from the same source. */
  clusterOf: Map<string, number>;
  /** Wallets that bought in the first 3 blocks of trading (whether or not they still hold). */
  snipers: Set<string>;
}

export async function checkHolders(token: TokenInfo, transfers: Transfer[]): Promise<{ checks: Check[]; facts: HolderFacts }> {
  const balances = new Map<string, bigint>();
  const firstFrom = new Map<string, string>(); // wallet -> who sent it its first tokens
  const firstBlock = new Map<string, bigint>();
  for (const t of transfers) {
    const from = t.from.toLowerCase(), to = t.to.toLowerCase();
    balances.set(from, (balances.get(from) ?? 0n) - t.value);
    balances.set(to, (balances.get(to) ?? 0n) + t.value);
    if (!firstFrom.has(to)) { firstFrom.set(to, from); firstBlock.set(to, t.block); }
  }
  for (const a of BURN) balances.delete(a);
  balances.delete(token.address.toLowerCase());

  const held = [...balances].filter(([, b]) => b > 0n).sort((a, b) => (b[1] > a[1] ? 1 : -1));
  const supply = token.totalSupply ?? held.reduce((s, [, b]) => s + b, 0n);
  const pct = (b: bigint) => (supply > 0n ? Number((b * 10_000n) / supply) / 100 : 0);
  const fmt = (b: bigint) => (b > 0n && pct(b) < 0.01 ? '<0.01' : String(pct(b)));

  // Which of the top holders, and of the wallets that seeded 3+ others, are contracts?
  // Routers and aggregators seed many wallets too, so every cluster source must be classified.
  const seeded = new Map<string, number>();
  for (const [a, src] of firstFrom) if (!BURN.has(src) && (balances.get(a) ?? 0n) > 0n) seeded.set(src, (seeded.get(src) ?? 0) + 1);
  const sources = [...seeded].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).map(([a]) => a);
  const list = [...new Set([...held.slice(0, 40).map(([a]) => a), ...sources.slice(0, 60)])].filter(a => !BURN.has(a));
  const { contracts, classified } = await classify(list);
  for (const a of Object.keys(KNOWN)) { contracts.add(a); classified.add(a); }

  // an address we couldn't classify is left out rather than counted as a person's wallet
  const wallets = held.filter(([a]) => !contracts.has(a) && (classified.has(a) || !held.slice(0, 40).some(([h]) => h === a)));
  const contractShare = pct(held.filter(([a]) => contracts.has(a)).reduce((s, [, b]) => s + b, 0n));
  const checks: Check[] = [];

  checks.push({
    group: 'holders', status: held.length < 50 ? 'warn' : 'info',
    title: `${held.length.toLocaleString('en-US')} holders`,
    detail: contractShare > 0 ? `${contractShare}% sits in pools, curves and lockers` : undefined,
    risk: held.length < 50 ? 5 : 0,
  });

  // Largest single wallet
  const top = wallets[0];
  if (top) {
    const p = pct(top[1]);
    checks.push({
      group: 'holders', status: p > 15 ? 'bad' : p > 5 ? 'warn' : 'ok',
      title: `Largest wallet holds ${fmt(top[1])}%`, detail: short(top[0]),
      risk: p > 15 ? 25 : p > 5 ? 10 : 0,
    });
  }

  // Top 10 wallets
  const top10 = pct(wallets.slice(0, 10).reduce((s, [, b]) => s + b, 0n));
  checks.push({
    group: 'holders', status: top10 > 50 ? 'bad' : top10 > 30 ? 'warn' : 'ok',
    title: `Top 10 wallets hold ${top10}%`, detail: 'excluding pools, curves and lockers',
    risk: top10 > 50 ? 25 : top10 > 30 ? 10 : 0,
  });

  // Clusters: 3+ wallets whose first tokens came straight from the same wallet (not a pool) —
  // the usual pattern when one person spreads supply across many addresses.
  const groups = new Map<string, string[]>();
  for (const [a] of wallets) {
    const src = firstFrom.get(a);
    // unclassified sources (past the 60 cap) are skipped rather than assumed to be wallets
    if (!src || BURN.has(src) || contracts.has(src) || !classified.has(src)) continue;
    groups.set(src, [...(groups.get(src) ?? []), a]);
  }
  const clusters = [...groups].filter(([, ws]) => ws.length >= 3);
  const clusterOf = new Map<string, number>();
  clusters.forEach(([, ws], i) => ws.forEach(w => clusterOf.set(w, i + 1)));
  if (clusters.length) {
    const members = clusters.flatMap(([, ws]) => ws);
    const share = pct(members.reduce((s, a) => s + (balances.get(a) ?? 0n), 0n));
    checks.push({
      group: 'holders', status: share > 25 ? 'bad' : share > 10 ? 'warn' : 'info',
      title: `${members.length} linked wallets hold ${share}%`,
      detail: `${clusters.length === 1 ? 'all funded' : `${clusters.length} groups, each funded`} with tokens from one wallet`,
      risk: share > 25 ? 25 : share > 10 ? 10 : 0,
    });
  } else {
    checks.push({ group: 'holders', status: 'ok', title: 'No linked-wallet clusters found', risk: 0 });
  }

  // Snipers: wallets that bought from a contract in the first 3 blocks of trading
  const sniperSet = new Set<string>();
  const firstBuy = transfers.find(t => contracts.has(t.from.toLowerCase()) && !contracts.has(t.to.toLowerCase()) && !BURN.has(t.to.toLowerCase()));
  if (firstBuy) {
    const snipers = wallets.filter(([a]) => {
      const b = firstBlock.get(a);
      return b !== undefined && b <= firstBuy.block + 2n && contracts.has(firstFrom.get(a) ?? '');
    });
    for (const [a, b] of firstBlock) if (b <= firstBuy.block + 2n && contracts.has(firstFrom.get(a) ?? '')) sniperSet.add(a);
    const everSniped = sniperSet.size;
    if (everSniped > 0) {
      const share = pct(snipers.reduce((s, [, b]) => s + b, 0n));
      checks.push({
        group: 'holders', status: share > 10 ? 'warn' : 'ok',
        title: share > 0 ? `Snipers still hold ${share}%` : 'Snipers have sold out',
        detail: `${everSniped} wallet${everSniped === 1 ? '' : 's'} bought in the first 3 blocks`,
        risk: share > 10 ? 10 : 0,
      });
    }
  }

  return { checks, facts: { holders: held.length, contracts, balances, clusterOf, snipers: sniperSet } };
}

/**
 * Splits addresses into contracts and wallets with getCode. Runs in small batches with retries:
 * a failed lookup must never turn a router into a "wallet", so failures stay unclassified.
 */
async function classify(addrs: string[]) {
  const contracts = new Set<string>();
  const classified = new Set<string>();
  for (let i = 0; i < addrs.length; i += 25) {
    const batch = addrs.slice(i, i + 25);
    const codes = await Promise.all(batch.map(a => withBackoff(() => client.getCode({ address: a as Hex })).catch(() => null)));
    batch.forEach((a, j) => {
      if (codes[j] === null) return;
      classified.add(a);
      if (codes[j] && codes[j] !== '0x') contracts.add(a);
    });
  }
  return { contracts, classified };
}
