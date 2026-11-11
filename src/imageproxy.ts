import { lookup } from 'node:dns/promises';
import type { ServerResponse } from 'node:http';
import { isIP } from 'node:net';

/** True for addresses on the public internet; false for loopback, private, link-local, CGNAT, multicast. */
function isPublicIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)));
  }
  if (isIP(ip) === 6) {
    const s = ip.toLowerCase();
    if (s === '::' || s === '::1' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith('ff')) return false;
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPublicIp(mapped[1]) : true;
  }
  return false;
}

/**
 * Image hosts are often bare public IPs, so unlike the website fetcher this allows IP literals,
 * but only public ones; and a hostname must resolve to public addresses only, so a token's image
 * link can never point the server at its own network.
 */
async function publicUrl(raw: string): Promise<URL | undefined> {
  let u: URL;
  try { u = new URL(raw); } catch { return undefined; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
  if (u.port && !['80', '443', '8080', '8443'].includes(u.port)) return undefined;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return isPublicIp(host) ? u : undefined;
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) return undefined;
  try {
    const addrs = await lookup(host, { all: true });
    return addrs.length && addrs.every(a => isPublicIp(a.address)) ? u : undefined;
  } catch { return undefined; }
}

/*
 * Token images come from whoever launched the token: often plain http (blocked on an https page)
 * or a host that forbids embedding elsewhere. /img?u=… fetches the picture server-side and hands
 * it back from tell.markets. Images only, small, public hosts only, cached in memory.
 */

const MAX_BYTES = 2_000_000;
const CACHE_MAX = 400;
const cache = new Map<string, { type: string; body: Buffer; at: number }>();
const failed = new Map<string, number>(); // url -> time of failure, so a dead host isn't hammered

export async function proxyImage(raw: string, res: ServerResponse) {
  const send = (status: number, type: string, body: Buffer | string, maxAge: number) => {
    res.writeHead(status, { 'content-type': type, 'cache-control': `public, max-age=${maxAge}`, 'x-content-type-options': 'nosniff' });
    res.end(body);
  };
  const hit = cache.get(raw);
  if (hit) return send(200, hit.type, hit.body, 86400);
  if (Date.now() - (failed.get(raw) ?? 0) < 10 * 60_000) return send(404, 'text/plain', 'no image', 600);

  let url = await publicUrl(raw);
  if (!url) return send(400, 'text/plain', 'bad url', 3600);
  try {
    let r: Response | undefined;
    for (let hop = 0; hop < 4; hop++) {
      r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'Mozilla/5.0 (compatible; TellBot/0.1; +https://tell.markets)', accept: 'image/*' } });
      const loc = r.status >= 300 && r.status < 400 ? r.headers.get('location') : null;
      if (!loc) break;
      const next = await publicUrl(new URL(loc, url).toString()); // every hop must stay on the public internet
      if (!next) throw new Error('redirect to a non-public address');
      url = next; r = undefined;
    }
    const type = r?.headers.get('content-type')?.split(';')[0].trim() ?? '';
    // svg can carry script; raster images only
    if (!r?.ok || !/^image\/(png|jpe?g|gif|webp|avif)$/.test(type)) throw new Error(`not an image (${r?.status} ${type})`);
    if (Number(r.headers.get('content-length') ?? 0) > MAX_BYTES) throw new Error('too large');
    const body = Buffer.from(await r.arrayBuffer());
    if (body.length > MAX_BYTES) throw new Error('too large');
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(raw, { type, body, at: Date.now() });
    send(200, type, body, 86400);
  } catch {
    failed.set(raw, Date.now());
    if (failed.size > 2000) failed.clear();
    send(404, 'text/plain', 'no image', 600);
  }
}
