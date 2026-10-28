import { readFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { analyze, resolveToken, type Report } from './analyze.js';
import { config } from './config.js';

const PAGE = new URL('../web/index.html', import.meta.url);
const APP = new URL('../web/app.html', import.meta.url);
const CACHE_MS = 10 * 60_000;
const RATE_LIMIT = 20; // checks per IP per minute

const TYPES: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml' };

const cache = new Map<string, { at: number; report: Report }>();
const hits = new Map<string, { at: number; n: number }>();

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (url.pathname === '/api/check') {
      return await check(url.searchParams.get('q') ?? '', url.searchParams.has('flow'), clientIp(req.headers, req.socket.remoteAddress), res);
    }
    // the app: "/app" and "/app/0x…"
    if (url.pathname === '/app' || url.pathname.startsWith('/app/')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(await readFile(APP));
    }
    // "/" and shareable report links "/t/0x…" both serve the page; it reads the address from the path.
    if (url.pathname === '/' || url.pathname.startsWith('/t/')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(await readFile(PAGE));
    }
    const asset = url.pathname.match(/^\/assets\/([\w.-]+\.(webp|png|jpg|svg))$/);
    if (asset) {
      const file = await readFile(new URL(`../web/assets/${asset[1]}`, import.meta.url)).catch(() => undefined);
      if (file) {
        res.writeHead(200, { 'content-type': TYPES[asset[2]], 'cache-control': 'public, max-age=86400' });
        return res.end(file);
      }
    }
    json(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    json(res, 500, { error: 'Could not check this token. Try again in a minute.' });
  }
}).listen(config.port, () => console.log(`Tell: http://localhost:${config.port}`));

async function check(q: string, withFlow: boolean, ip: string, res: ServerResponse) {
  if (!allow(ip)) return json(res, 429, { error: 'Too many checks. Wait a minute.' });

  const address = await resolveToken(q);
  if (!address) return json(res, 400, { error: 'No token address found. Paste a 0x… address or a DexScreener link.' });

  const key = address.toLowerCase();
  const hit = cache.get(key);
  let report = hit && Date.now() - hit.at < CACHE_MS ? hit.report : undefined;
  if (!report) {
    report = await analyze(address);
    cache.set(key, { at: Date.now(), report });
  }
  json(res, 200, withFlow ? report : { ...report, flow: undefined });
}

function allow(ip: string) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.at > 60_000) {
    hits.set(ip, { at: now, n: 1 });
    return true;
  }
  return ++h.n <= RATE_LIMIT;
}

function clientIp(headers: Record<string, string | string[] | undefined>, fallback?: string) {
  const fwd = headers['x-forwarded-for'];
  return (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0].trim() || fallback || 'unknown';
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  // totalSupply is a bigint, which JSON can't carry as-is.
  res.end(JSON.stringify(body, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
}
