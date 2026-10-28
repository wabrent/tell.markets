const BASE = 'https://api.dexscreener.com';
const CHAIN = 'robinhood';

export interface DexPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  labels?: string[];
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  txns?: { h24?: { buys: number; sells: number } };
  marketCap?: number;
  fdv?: number;
  pairCreatedAt?: number;
  info?: {
    imageUrl?: string;
    websites?: { label?: string; url: string }[];
    socials?: { type: string; url: string }[];
  };
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`DexScreener ${res.status} for ${path}`);
  return res.json() as Promise<T>;
}

/** All pairs where the token is base or quote, biggest liquidity first. */
export async function getTokenPairs(token: string): Promise<DexPair[]> {
  const pairs = await get<DexPair[]>(`/tokens/v1/${CHAIN}/${token}`);
  return (pairs ?? []).sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
}

/** Pairs for up to 30 tokens in one call. */
export async function getTokensPairs(tokens: string[]): Promise<DexPair[]> {
  if (!tokens.length) return [];
  return (await get<DexPair[]>(`/tokens/v1/${CHAIN}/${tokens.slice(0, 30).join(',')}`)) ?? [];
}

/** Resolves a pair / Uniswap v4 pool id to its pair data. */
export async function getPair(pairId: string): Promise<DexPair | undefined> {
  const res = await get<{ pairs: DexPair[] | null }>(`/latest/dex/pairs/${CHAIN}/${pairId}`);
  return res.pairs?.[0];
}
