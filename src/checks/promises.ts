import { safeUrl, type Site } from '../sources/website.js';
import type { Check, TokenInfo } from './types.js';

/*
 * "Promises vs the chain": what a project says on its site, checked against what can be seen.
 * Each check is cheap and deterministic; the AI review adds the judgement calls afterwards.
 */

/** The real Pons launchpad. Look-alikes (pons.family and friends) get flagged. */
const PONS_OFFICIAL = new Set(['ponsfamily.com', 'www.ponsfamily.com']);

export async function checkPromises(token: TokenInfo, site: Site | undefined, burnedPct: number | undefined): Promise<Check[]> {
  if (!site?.ok) return [];
  const links = site.links
    .map(l => { try { return { text: l.text, url: new URL(l.href, site.url) }; } catch { return undefined; } })
    .filter((l): l is { text: string; url: URL } => Boolean(l));

  const checks: Check[] = [
    ...launchpadLinks(token, links),
    ...burnPromise(site.text, burnedPct),
    ...auditClaims(site.text, links),
  ];
  const [gh, app] = await Promise.all([github(links), appLink(links, site.url)]);
  checks.push(...gh, ...app);
  return checks;
}

function launchpadLinks(token: TokenInfo, links: { url: URL }[]): Check[] {
  const pons = links.filter(l => /pons/i.test(l.url.hostname));
  if (!pons.length) return [];
  const fake = pons.find(l => !PONS_OFFICIAL.has(l.url.hostname.toLowerCase()));
  if (fake) {
    return [{
      group: 'website', status: 'bad', title: 'Buy link goes to a look-alike Pons domain',
      detail: `${fake.url.hostname} is not ponsfamily.com`, risk: 25,
    }];
  }
  const own = token.address.toLowerCase();
  const other = pons.find(l => { const a = l.url.href.match(/0x[a-fA-F0-9]{40}/)?.[0]; return a && a.toLowerCase() !== own; });
  if (other) {
    return [{ group: 'website', status: 'warn', title: 'Pons link points to a different token', detail: 'the site links another contract on the launchpad', risk: 15 }];
  }
  return [{ group: 'website', status: 'ok', title: 'Buy link goes to the real Pons launchpad', risk: 0 }];
}

function burnPromise(text: string, burnedPct: number | undefined): Check[] {
  if (!/\b(burn(s|ed|ing)?|buy[\s-]?backs?)\b/i.test(text) || burnedPct === undefined) return [];
  if (burnedPct > 0) {
    // burn addresses also collect launchpad-side burns, so this confirms burns exist, not who made them
    return [{ group: 'website', status: 'ok', title: `Burns promised, ${fmtPct(burnedPct)} of supply at burn addresses`, detail: 'includes any launchpad burns', risk: 0 }];
  }
  return [{
    group: 'website', status: 'warn', title: 'Buybacks or burns promised, none on-chain yet',
    detail: 'no tokens have been sent to a burn address', risk: 5,
  }];
}

const AUDIT_CLAIM = /\b(audited by|audit(ed)?\s*(\(|:|-|–|—)?\s*(done|complete[d]?|passed|finished))\b/i;
const AUDIT_DENIAL = /\b(not\s+(yet\s+)?(been\s+)?audited|unaudited|no\s+audit|audit\s+(is\s+)?(pending|planned|coming|in progress|next))\b/i;

function auditClaims(text: string, links: { text: string; url: URL }[]): Check[] {
  const claims = AUDIT_CLAIM.test(text);
  const denies = AUDIT_DENIAL.test(text);
  if (claims && denies) {
    return [{ group: 'website', status: 'warn', title: 'Site contradicts itself on the audit', detail: 'says audited in one place and not audited in another', risk: 10 }];
  }
  if (claims) {
    const report = links.some(l => /audit/i.test(l.text + ' ' + l.url.pathname) || /\.pdf$/i.test(l.url.pathname));
    return report
      ? [{ group: 'website', status: 'info', title: 'Audit claimed, report linked', detail: 'read who audited it and what they found', risk: 0 }]
      : [{ group: 'website', status: 'warn', title: 'Audit claimed, no report linked', risk: 5 }];
  }
  return [];
}

// GitHub's public API allows 60 calls an hour without a token, so answers are kept for 6 hours.
const ghCache = new Map<string, { at: number; check: Check }>();

async function github(links: { url: URL }[]): Promise<Check[]> {
  const gh = links.find(l => l.url.hostname === 'github.com' && l.url.pathname.split('/').filter(Boolean).length >= 1);
  if (!gh) return [];
  const [owner, repo] = gh.url.pathname.split('/').filter(Boolean);
  const key = `${owner}/${repo ?? ''}`.toLowerCase();
  const hit = ghCache.get(key);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return [hit.check];

  const api = repo
    ? `https://api.github.com/repos/${owner}/${repo}`
    : `https://api.github.com/users/${owner}/repos?sort=pushed&per_page=1`;
  let check: Check | undefined;
  try {
    const res = await fetch(api, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/vnd.github+json', 'user-agent': 'TellBot (+https://tell.markets)' } });
    if (res.status === 404) {
      check = { group: 'website', status: 'warn', title: 'GitHub link is dead', detail: `github.com/${key.replace(/\/$/, '')} not found`, risk: 10 };
    } else if (res.ok) {
      const body = await res.json() as { pushed_at?: string } | { pushed_at?: string }[];
      const pushed = Array.isArray(body) ? body[0]?.pushed_at : body.pushed_at;
      if (!pushed) {
        check = { group: 'website', status: 'warn', title: 'GitHub has no public code', risk: 5 };
      } else {
        const days = Math.floor((Date.now() - Date.parse(pushed)) / 86_400_000);
        check = days <= 30
          ? { group: 'website', status: 'ok', title: `GitHub active: last push ${days === 0 ? 'today' : `${days}d ago`}`, risk: 0 }
          : days <= 90
            ? { group: 'website', status: 'info', title: `GitHub last push ${days}d ago`, risk: 0 }
            : { group: 'website', status: 'warn', title: `GitHub quiet for ${days} days`, risk: 5 };
      }
    }
  } catch { /* GitHub unreachable or rate-limited: say nothing rather than guess */ }
  if (!check) return [];
  ghCache.set(key, { at: Date.now(), check });
  return [check];
}

/** A "Launch app" link that 404s is the cheapest way to fake a product. */
async function appLink(links: { text: string; url: URL }[], siteUrl: string): Promise<Check[]> {
  const site = new URL(siteUrl);
  const app = links.find(l =>
    /^(launch\s+app|open\s+app|app|dapp|dashboard|go\s+to\s+app|enter\s+app)\b/i.test(l.text.trim()) ||
    (/^app\./i.test(l.url.hostname) && l.url.hostname !== site.hostname));
  if (!app) return [];
  const url = safeUrl(app.url.href);
  if (!url) return [];
  try {
    // manual: a redirect counts as "opens", and the server never follows a hop into its own network
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'Mozilla/5.0 (compatible; TellBot/0.1; +https://tell.markets)' } });
    await res.body?.cancel();
    return res.status < 400
      ? [{ group: 'website', status: 'ok', title: 'App link opens', detail: url.host + url.pathname, risk: 0 }]
      : [{ group: 'website', status: 'warn', title: 'App link is broken', detail: `HTTP ${res.status}`, risk: 10 }];
  } catch {
    return [{ group: 'website', status: 'warn', title: "App link doesn't load", detail: url.host, risk: 10 }];
  }
}

const fmtPct = (n: number) => (n >= 1 ? `${n.toFixed(1)}%` : n >= 0.01 ? `${n.toFixed(2)}%` : '<0.01%');
