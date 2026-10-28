import type { DexPair } from '../sources/dexscreener.js';
import type { LaunchMeta } from '../sources/launch.js';
import type { Check } from './types.js';

export function checkMarket(pairs: DexPair[]): Check[] {
  const main = pairs[0];
  if (!main) {
    return [{
      group: 'market', status: 'warn', title: 'No DEX pool found',
      detail: 'still on the bonding curve or not trading', risk: 15,
    }];
  }

  const checks: Check[] = [];
  const liq = main.liquidity?.usd ?? 0;
  if (liq < 5_000) {
    checks.push({ group: 'market', status: 'bad', title: `Liquidity ${usd(liq)}`, detail: 'very thin, easy to move the price', risk: 20 });
  } else if (liq < 25_000) {
    checks.push({ group: 'market', status: 'warn', title: `Liquidity ${usd(liq)}`, detail: 'low', risk: 10 });
  } else {
    checks.push({ group: 'market', status: 'ok', title: `Liquidity ${usd(liq)}`, risk: 0 });
  }

  if (main.pairCreatedAt) {
    const hours = (Date.now() - main.pairCreatedAt) / 3_600_000;
    const age = hours < 48 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`;
    checks.push({
      group: 'market', status: hours < 24 ? 'warn' : 'info', title: `Pool age ${age}`,
      detail: hours < 24 ? 'brand new, little data yet' : undefined, risk: hours < 24 ? 5 : 0,
    });
  }

  const tx = main.txns?.h24;
  if (tx && tx.buys + tx.sells > 20) {
    const sellShare = tx.sells / (tx.buys + tx.sells);
    if (sellShare > 0.7) {
      checks.push({ group: 'market', status: 'warn', title: `${Math.round(sellShare * 100)}% of trades in 24h are sells`, risk: 10 });
    }
  }

  return checks;
}

/** Links from the DEX listing, or from the launch itself for tokens still on a bonding curve. */
export function checkSocials(pairs: DexPair[], meta?: LaunchMeta): Check[] {
  const info = pairs.find(p => p.info)?.info;
  const sites = info?.websites?.length ? info.websites : meta?.website ? [{ url: meta.website }] : [];
  const socials = info?.socials?.length ? info.socials : meta?.socials ?? [];
  const checks: Check[] = [];

  checks.push(sites.length
    ? { group: 'website', status: 'info', title: 'Website listed', detail: sites[0].url, risk: 0 }
    : { group: 'website', status: 'warn', title: 'No website listed', risk: 10 });

  const kinds = socials.map(s => s.type);
  checks.push(kinds.length
    ? { group: 'website', status: 'info', title: `Socials: ${kinds.join(', ')}`, risk: 0 }
    : { group: 'website', status: 'warn', title: 'No socials listed', risk: 10 });

  return checks;
}

export function usd(n: number) {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}
