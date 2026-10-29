import { getAddress, isAddress, zeroAddress } from 'viem';
import { checkContract, readToken } from './checks/contract.js';
import { checkDeployer, type DeployerFacts } from './checks/deployer.js';
import { checkHolders } from './checks/holders.js';
import { checkMarket, checkSocials } from './checks/market.js';
import { aiReview } from './ai/review.js';
import { aiChecks, checkSite } from './checks/website.js';
import { fetchTransfers } from './sources/logs.js';
import { fetchSite } from './sources/website.js';
import { launchMeta, type LaunchMeta } from './sources/launch.js';
import { client, withBackoff } from './sources/rpc.js';
import type { Check, TokenInfo } from './checks/types.js';
import { getPair, getTokenPairs, type DexPair } from './sources/dexscreener.js';
import { buildFlow, type FlowGraph } from './flow.js';
import { config } from './config.js';
import { knownAsset, tellIdentity } from './known.js';
import { score, type Score } from './scoring.js';

export interface Report {
  token: TokenInfo;
  pairs: DexPair[];
  checks: Check[];
  facts: Facts;
  score: Score;
  verdict: string;
  /** True when the verdict was written by the AI rather than assembled from the checks. */
  aiVerdict: boolean;
  /** Image, description and links the token was launched with. */
  meta?: LaunchMeta;
  /** Token map for the app. Large, so /api/check leaves it out unless asked. */
  flow?: FlowGraph;
  /** The map covers only the latest transfers of a very busy token. */
  flowPartial?: boolean;
  /** Some data failed to load (usually RPC rate limits); kept only briefly. */
  degraded?: boolean;
  ms: number;
}

export interface Facts {
  holders?: number;
  deployer?: string;
  launches?: number;
}

/**
 * Finds the token address in whatever the user sent: a bare address, a DexScreener link
 * (pair address or 32-byte Uniswap v4 pool id), or any URL that contains an address.
 */
export async function resolveToken(input: string): Promise<`0x${string}` | undefined> {
  const addr = input.match(/0x[a-fA-F0-9]{40}(?![a-fA-F0-9])/)?.[0];
  const poolId = input.match(/0x[a-fA-F0-9]{64}/)?.[0];

  if (poolId) {
    const pair = await getPair(poolId).catch(() => undefined);
    if (pair) return getAddress(pair.baseToken.address);
  }
  if (addr && isAddress(addr)) {
    // A DexScreener v2/v3 link carries the pair address, not the token.
    if (input.includes('dexscreener.com')) {
      const pair = await getPair(addr).catch(() => undefined);
      if (pair) return getAddress(pair.baseToken.address);
    }
    return getAddress(addr);
  }
  return undefined;
}

export async function analyze(address: `0x${string}`): Promise<Report> {
  const started = Date.now();
  let [token, pairs] = await Promise.all([
    readToken(address),
    getTokenPairs(address).catch(() => [] as DexPair[]),
  ]);
  // a busy RPC can drop these reads; one more try before calling it "not a standard token"
  if (token.symbol === undefined || token.totalSupply === undefined) {
    await new Promise(r => setTimeout(r, 1500));
    token = await readToken(address);
  }
  const ownPairs = pairs.filter(p => p.baseToken.address.toLowerCase() === address.toLowerCase());

  // The site usually comes from the DEX listing; tokens still on a bonding curve only have the
  // link they were launched with, which we learn from the launch transaction.
  const listedSite = ownPairs.find(p => p.info?.websites?.length)?.info?.websites?.[0]?.url;
  const [contractChecks, onchain, listed] = await Promise.all([
    checkContract(token),
    checkOnchain(token, ownPairs),
    listedSite ? fetchSite(listedSite) : Promise.resolve(undefined),
  ]);
  const meta = onchain.meta;
  const site = listed ?? (meta?.website ? await fetchSite(meta.website) : undefined);
  const checks = [
    ...contractChecks,
    ...onchain.checks,
    ...checkMarket(ownPairs),
    ...checkSocials(ownPairs, meta),
    ...checkSite(token, site),
  ];

  // Stablecoins, WETH and stock tokens keep owner powers by design; don't score them like a memecoin.
  const known = knownAsset(address);
  if (known) {
    for (const c of checks) {
      if (c.group !== 'contract' || c.status === 'ok') continue;
      c.status = 'info'; c.risk = 0; c.critical = false;
      c.detail = 'expected for this asset';
    }
    checks.unshift({ group: 'contract', status: 'ok', title: `Recognized asset: ${known}`, risk: 0 });
  }

  // Tell's own token is the one people will try to fake
  const tell = tellIdentity(address, token.name, token.symbol);
  if (tell === 'official') {
    checks.unshift({ group: 'contract', status: 'ok', title: 'Official $TELL token', detail: 'the address published on tell.markets', risk: 0 });
  } else if (tell === 'impostor') {
    checks.unshift({
      group: 'contract', status: 'bad', title: 'Fake $TELL: not the official token',
      detail: config.tellToken
        ? `the only official $TELL is ${config.tellToken.slice(0, 6)}…${config.tellToken.slice(-4)}, published on tell.markets`
        : 'Tell has not launched a token yet; anything called TELL is an impersonation',
      risk: 80, critical: true,
    });
  }

  // The AI reads the site and sees every other finding, so it runs last.
  const review = await aiReview(token, checks, site, meta?.description);
  checks.push(...aiChecks(review, site));

  return {
    token, pairs: ownPairs, checks, facts: onchain.facts, flow: onchain.flow, flowPartial: onchain.flowPartial, meta,
    score: score(checks), verdict: review?.verdict || verdict(checks), aiVerdict: Boolean(review?.verdict),
    // a token we couldn't read or whose history failed to load: show it, but don't trust it for long
    degraded: onchain.degraded || token.symbol === undefined || token.totalSupply === undefined,
    ms: Date.now() - started,
  };
}

/** Holders and deployer both come from the token's full transfer history. */
async function checkOnchain(token: TokenInfo, pairs: DexPair[]): Promise<{ checks: Check[]; facts: Facts; flow?: FlowGraph; flowPartial?: boolean; meta?: LaunchMeta; degraded?: boolean }> {
  try {
    const { transfers, complete } = await fetchTransfers(token.address);
    if (!complete) {
      // Busy token: holder and deployer checks need the full history, but the latest transfers
      // still make a useful map of where the supply is moving now.
      const recent = await checkHolders(token, transfers).catch(() => undefined);
      return {
        checks: [{ group: 'holders', status: 'info', title: 'Busy token: holder checks skipped', detail: 'more than 40k transfers; the map shows the latest ones', risk: 0 }],
        facts: {},
        flow: recent ? buildFlow(token, transfers, recent.facts, undefined, pairs) : undefined,
        flowPartial: true,
      };
    }
    const mint = transfers.find(t => t.from === zeroAddress);
    const metaP = mint
      ? withBackoff(() => client.getTransaction({ hash: mint.tx })).then(tx => launchMeta(tx.input)).catch(() => undefined)
      : Promise.resolve(undefined);
    const holdersP = checkHolders(token, transfers);
    const [holders, deployer] = await Promise.all([
      holdersP,
      checkDeployer(token, transfers, holdersP.then(h => h.facts)).catch(err => {
        console.error('deployer check failed', err);
        return { checks: [] as Check[], facts: {} as DeployerFacts };
      }),
    ]);
    return {
      checks: [...holders.checks, ...deployer.checks],
      facts: { holders: holders.facts.holders, deployer: deployer.facts.address, launches: deployer.facts.launches },
      flow: buildFlow(token, transfers, holders.facts, deployer.facts.address, pairs),
      meta: await metaP,
    };
  } catch (err) {
    console.error('on-chain checks failed', (err as Error)?.message ?? err);
    return {
      checks: [{ group: 'holders', status: 'info', title: 'Holder data is unavailable right now', detail: 'the network was busy; check again in a minute', risk: 0 }],
      facts: {}, degraded: true,
    };
  }
}

/** Rule-based one-liner until the AI verdict lands: the two worst findings, or an all-clear. */
function verdict(checks: Check[]): string {
  const rank = { bad: 0, warn: 1, info: 2, ok: 3 } as const;
  const worst = checks
    .filter(c => c.status === 'bad' || c.status === 'warn')
    .sort((a, b) => rank[a.status] - rank[b.status] || b.risk - a.risk)
    .slice(0, 2)
    .map(c => c.title);
  if (!worst.length) return 'No obvious red flags in the contract, holders, deployer or market.';
  return worst.join('. ') + '.';
}
