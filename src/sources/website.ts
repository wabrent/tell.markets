import { isIP } from 'node:net';

export interface Site {
  url: string;
  ok: boolean;
  status?: number;
  title?: string;
  /** Visible text, tags stripped, capped at MAX_TEXT. */
  text: string;
  truncated: boolean;
  links: { text: string; href: string }[];
  /** Every 0x… address that appears anywhere in the HTML. */
  addresses: string[];
  error?: string;
}

const MAX_TEXT = 24_000;
const MAX_HTML = 3_000_000;

/**
 * The URL comes from DexScreener, i.e. whoever listed the token. Refuse anything that isn't a
 * public http(s) host so a listing can't point the server at its own network.
 */
function safeUrl(raw: string): URL | undefined {
  let u: URL;
  try { u = new URL(raw); } catch { return undefined; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return undefined;
  if (isIP(host.replace(/^\[|\]$/g, ''))) return undefined;
  return u;
}

export async function fetchSite(raw: string): Promise<Site> {
  const url = safeUrl(raw);
  const empty = { url: raw, text: '', truncated: false, links: [], addresses: [] };
  if (!url) return { ...empty, ok: false, error: 'not a public http(s) address' };

  // follow redirects by hand so every hop is checked before we request it
  let res: Response | undefined;
  let current = url;
  try {
    for (let hop = 0; hop < 5; hop++) {
      res = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(12_000),
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; TellBot/0.1; +https://tell.markets)', accept: 'text/html,*/*' },
      });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!loc) break;
      const next = safeUrl(new URL(loc, current).toString());
      if (!next) return { ...empty, ok: false, error: 'redirected to a non-public address' };
      current = next;
      res = undefined;
    }
  } catch (e: any) {
    return { ...empty, ok: false, error: e?.name === 'TimeoutError' ? 'timed out' : 'could not connect' };
  }
  if (!res) return { ...empty, ok: false, error: 'too many redirects' };

  const html = (await res.text()).slice(0, MAX_HTML);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  const addresses = [...new Set((html.match(/0x[a-fA-F0-9]{40}(?![a-fA-F0-9])/g) ?? []).map(a => a.toLowerCase()))];

  const links: Site['links'] = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = strip(m[2]).slice(0, 80);
    if (links.length < 80) links.push({ text, href: m[1].slice(0, 200) });
  }

  // meta description and Open Graph often carry the pitch on JS-rendered sites
  const metas = [...html.matchAll(/<meta\b[^>]*(?:name|property)=["'](?:description|og:description|og:title|twitter:description)["'][^>]*content=["']([^"']*)["']/gi)].map(m => m[1]);
  let text = [...metas, strip(html)].filter(Boolean).join('\n');
  const truncated = text.length > MAX_TEXT;
  if (truncated) text = text.slice(0, MAX_TEXT);

  return { url: current.toString(), ok: res.ok, status: res.status, title, text, truncated, links, addresses };
}

function strip(html: string) {
  return html
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|section|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}
