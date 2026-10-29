import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { isAddress, type Hex } from 'viem';
import { resolveToken, type Report } from './analyze.js';
import { isHolder, newNonce, sessionAddress, signInMessage, signOut, tellBalance, verify } from './auth.js';
import { aiStatus } from './ai/review.js';
import { config } from './config.js';
import { launchesResponse, startLaunchWatcher } from './launches.js';
import { siteCard, tokenCard } from './og.js';
import { cachedReport, getReport, scoreHistory } from './reports.js';

const PAGES: Record<string, URL> = {
  index: new URL('../web/index.html', import.meta.url),
  app: new URL('../web/app.html', import.meta.url),
  launches: new URL('../web/launches.html', import.meta.url),
  compare: new URL('../web/compare.html', import.meta.url),
};
const TYPES: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml', js: 'text/javascript; charset=utf-8' };
const RATE_LIMIT = 20; // checks per IP per minute

const hits = new Map<string, { at: number; n: number }>();
const daily = new Map<string, { day: string; n: number }>();
const cards = new Map<string, Buffer>();

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  try {
    // ---------- API ----------
    if (path === '/api/check') return await check(req, res, url);
    if (path === '/api/launches') return json(res, 200, await launchesResponse(config.launchWatcher));
    if (path === '/api/health') {
      return json(res, 200, {
        ok: true, ai: aiStatus, launchWatcher: config.launchWatcher,
        rpc: config.rpcUrl.includes('rpc.mainnet.chain.robinhood.com') ? 'public' : 'custom',
        publicUrl: config.publicUrl || null, vercel: Boolean(process.env.VERCEL),
      });
    }
    if (path === '/api/auth/nonce') {
      const address = url.searchParams.get('address') ?? '';
      if (!isAddress(address)) return json(res, 400, { error: 'Bad address' });
      const nonce = newNonce();
      return json(res, 200, { nonce, message: signInMessage(address, nonce) });
    }
    if (path === '/api/auth/verify' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req)) as { address: string; nonce: string; signature: Hex };
      const sid = await verify(body.address, body.nonce, body.signature);
      if (!sid) return json(res, 401, { error: 'Signature did not check out' });
      res.setHeader('set-cookie', `tell_sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}${secure(req) ? '; Secure' : ''}`);
      return json(res, 200, await me(body.address));
    }
    if (path === '/api/auth/logout' && req.method === 'POST') {
      signOut(req.headers.cookie);
      res.setHeader('set-cookie', 'tell_sid=; Path=/; Max-Age=0');
      return json(res, 200, { ok: true });
    }
    if (path === '/api/me') return json(res, 200, await me(sessionAddress(req.headers.cookie)));

    // ---------- share cards ----------
    if (path === '/og/site.png') return png(res, cards.get('site') ?? cards.set('site', siteCard()).get('site')!);
    const og = path.match(/^\/og\/(0x[a-fA-F0-9]{40})\.png$/);
    if (og) {
      // ?dl=1 is a person saving the card to attach to a post: build the report if this instance
      // doesn't have it, and send it as a file. Crawlers (no dl) get the site card instead of waiting.
      const download = url.searchParams.has('dl');
      let c = cachedReport(og[1]);
      if (!c && download) { await getReport(og[1] as Hex); c = cachedReport(og[1]); }
      if (!c) return png(res, cards.get('site') ?? cards.set('site', siteCard()).get('site')!);
      const key = `${og[1].toLowerCase()}:${c.at}`;
      if (!cards.has(key)) { if (cards.size > 300) cards.clear(); cards.set(key, tokenCard(c.report)); }
      if (download) {
        const name = `tell-${(c.report.token.symbol || og[1].slice(0, 8)).replace(/[^\w-]/g, '')}.png`;
        res.setHeader('content-disposition', `attachment; filename="${name}"`);
      }
      return png(res, cards.get(key)!);
    }

    // ---------- pages ----------
    const addr = path.match(/^\/(?:t|app)\/(0x[a-fA-F0-9]{40})/)?.[1];
    if (path === '/' || path.startsWith('/t/')) return page(req, res, 'index', addr);
    if (path === '/app' || path.startsWith('/app/')) return page(req, res, 'app', addr);
    if (path === '/launches') return page(req, res, 'launches');
    if (path === '/compare') return page(req, res, 'compare');

    const asset = path.match(/^\/assets\/([\w.-]+\.(webp|png|jpg|svg|js))$/);
    if (asset) {
      const file = await readFile(new URL(`../web/assets/${asset[1]}`, import.meta.url)).catch(() => undefined);
      if (file) {
        res.writeHead(200, { 'content-type': TYPES[asset[2]], 'cache-control': asset[2] === 'js' ? 'no-cache' : 'public, max-age=86400' });
        return res.end(file);
      }
    }
    json(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: 'Could not check this token. Try again in a minute.' });
  }
}).listen(config.port, () => {
  console.log(`Tell: http://localhost:${config.port}`);
  if (config.launchWatcher) startLaunchWatcher();
});

async function check(req: IncomingMessage, res: ServerResponse, url: URL) {
  const ip = clientIp(req);
  if (!allow(ip)) return json(res, 429, { error: 'Too many checks. Wait a minute.' });

  const address = await resolveToken(url.searchParams.get('q') ?? '');
  if (!address) return json(res, 400, { error: 'No token address found. Paste a 0x… address or a DexScreener link.' });

  // free tier: only enforced once $TELL exists and a limit is configured
  if (config.freeChecksPerDay > 0 && !cachedReport(address)) {
    const who = sessionAddress(req.headers.cookie);
    if (!(await isHolder(who))) {
      const day = new Date().toISOString().slice(0, 10);
      const key = who ?? ip;
      const d = daily.get(key);
      const n = d?.day === day ? d.n : 0;
      if (n >= config.freeChecksPerDay) {
        return json(res, 402, { error: `Free limit reached: ${config.freeChecksPerDay} new checks a day. Hold $TELL for unlimited checks.` });
      }
      daily.set(key, { day, n: n + 1 });
    }
  }

  const report = await getReport(address);
  const body: Report & { history: unknown } = { ...report, history: scoreHistory(address).slice(-60) };
  json(res, 200, url.searchParams.has('flow') ? body : { ...body, flow: undefined });
}

async function me(address: string | undefined) {
  const holds = address ? await tellBalance(address).catch(() => 0) : 0;
  return {
    address: address ?? null,
    tokenLive: Boolean(config.tellToken),
    holds,
    holderMin: config.holderMin,
    holder: Boolean(config.tellToken) && holds >= config.holderMin,
    freeChecksPerDay: config.freeChecksPerDay,
  };
}

/** Serves a page with share-card tags for the token in its URL, so links unfurl on X. */
async function page(req: IncomingMessage, res: ServerResponse, name: string, addr?: string) {
  let html = await readFile(PAGES[name], 'utf8');
  const base = config.publicUrl || `${secure(req) ? 'https' : 'http'}://${req.headers.host}`;
  const c = addr ? cachedReport(addr) : undefined;
  const sym = c?.report.token.symbol ? `$${c.report.token.symbol}` : undefined;
  const title = c ? `${sym ?? 'Token'}: ${c.report.score.value}/100 risk — Tell` : 'Tell — read the tell before you buy';
  const desc = c ? c.report.verdict : 'Launch checks on Robinhood Chain: contract, holders, deployer and website in one risk score.';
  const image = c && addr ? `${base}/og/${addr}.png?v=${c.at}` : `${base}/og/site.png`;
  const tags = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Tell">`,
    `<meta property="og:title" content="${attr(title)}">`,
    `<meta property="og:description" content="${attr(desc)}">`,
    `<meta property="og:image" content="${attr(image)}">`,
    `<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">`,
    `<meta property="og:url" content="${attr(base + (req.url ?? '/'))}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${attr(title)}">`,
    `<meta name="twitter:description" content="${attr(desc)}">`,
    `<meta name="twitter:image" content="${attr(image)}">`,
  ].join('\n');
  html = html.replace('</head>', `${tags}\n</head>`);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
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

function clientIp(req: IncomingMessage) {
  const fwd = req.headers['x-forwarded-for'];
  return (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

const secure = (req: IncomingMessage) => req.headers['x-forwarded-proto'] === 'https';
const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 10_000) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function png(res: ServerResponse, buf: Buffer) {
  res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=600' });
  res.end(buf);
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  // totalSupply is a bigint, which JSON can't carry as-is.
  res.end(JSON.stringify(body, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
}
