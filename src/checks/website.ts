import type { AiReview } from '../ai/review.js';
import type { Site } from '../sources/website.js';
import type { Check, TokenInfo } from './types.js';

/** Checks we can make about the site without AI. */
export function checkSite(token: TokenInfo, site: Site | undefined): Check[] {
  if (!site) return [];
  if (!site.ok) {
    return [{
      group: 'website', status: 'warn', title: "Website doesn't load",
      detail: site.error ?? (site.status ? `HTTP ${site.status}` : undefined), risk: 10,
    }];
  }
  const own = token.address.toLowerCase();
  if (site.addresses.includes(own)) {
    return [{ group: 'website', status: 'ok', title: 'Contract address on site matches', risk: 0 }];
  }
  if (site.addresses.length) {
    return [{
      group: 'website', status: 'warn', title: "Site lists other addresses, not this token's",
      detail: 'check you have the right contract', risk: 10,
    }];
  }
  return [{ group: 'website', status: 'info', title: "Couldn't find the contract address on the site", detail: 'it may only appear after the page runs its scripts', risk: 0 }];
}

const PRODUCT: Record<AiReview['product'], Omit<Check, 'group' | 'detail'> | undefined> = {
  working_product: { status: 'ok', title: 'Working product on the site', risk: 0 },
  beta_or_testnet: { status: 'info', title: 'Product in beta or on testnet', risk: 0 },
  landing_only: { status: 'warn', title: 'Landing page only, no product yet', risk: 10 },
  waitlist_only: { status: 'bad', title: 'Waitlist only', risk: 15 },
  no_site: undefined,
};

/** Turns the AI review into checks. AI findings can only add risk, never remove it. */
export function aiChecks(review: AiReview | undefined, site: Site | undefined): Check[] {
  if (!site?.ok) return [];
  if (!review) return [{ group: 'website', status: 'info', title: 'AI review unavailable right now', risk: 0 }];

  const checks: Check[] = [];
  const p = PRODUCT[review.product];
  if (p) checks.push({ group: 'website', ...p, detail: review.product_note || undefined });
  for (const f of review.red_flags.slice(0, 4)) {
    checks.push({
      group: 'website', status: f.severity === 'high' ? 'bad' : 'warn',
      title: f.title, detail: f.detail, risk: f.severity === 'high' ? 20 : 5,
    });
  }
  return checks;
}
