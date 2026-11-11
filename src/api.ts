import type { IncomingMessage, ServerResponse } from 'node:http';
import { getAddress } from 'viem';
import { resolveToken } from './analyze.js';
import { sessionAddress } from './auth.js';
import { config } from './config.js';
import { createKey, keyFrom, keyIsHolder, keysOf } from './keys.js';
import { launchFeed } from './launches.js';
import { proofFor, proofSummary, tellBurned } from './proof.js';
import { fullCheck, quickCheck, type Answer } from './quick.js';
import { accuracyRows, accuracySummary } from './accuracy.js';
import { recentCheckMs } from './reports.js';
import { paymentResponseHeader, paymentsEnabled, readPayment, requirements, revenue, sendPaymentRequired, settlePayment, USDG, verifyPayment } from './x402.js';

/*
 * Public API for agents and apps: /api/v1/*. JSON in, JSON out, CORS open.
 *   quick checks  free, rate limited
 *   full checks   FREE_FULL_PER_DAY free per caller, then x402 (USDG), free for $TELL holders' keys
 */

const RATE = 60; // requests per caller per minute
const hits = new Map<string, { at: number; n: number }>();
const fullUsed = new Map<string, { day: string; n: number }>();

export type Level = 'low' | 'medium' | 'caution' | 'high';
const level = (v: number): Level => (v >= 80 ? 'high' : v >= 60 ? 'caution' : v >= 30 ? 'medium' : 'low');

/** Compact, stable shape for machines. The full report stays available on the site. */
export function summary(a: Answer, base: string) {
  const r = a.report;
  const addr = r.token.address;
  const p = r.pairs?.[0];
  return {
    token: { address: addr, name: r.token.name ?? null, symbol: r.token.symbol ?? null, chainId: 4663 },
    risk: { score: r.score.value, label: r.score.label, level: level(r.score.value) },
    verdict: r.verdict,
    aiVerdict: r.aiVerdict,
    critical: r.checks.filter(c => c.critical).map(c => c.title),
    flags: r.checks.filter(c => c.status === 'bad' || c.status === 'warn').map(c => ({ group: c.group, severity: c.status, title: c.title, detail: c.detail ?? null, risk: c.risk })),
    passed: r.checks.filter(c => c.status === 'ok').map(c => ({ group: c.group, title: c.title })),
    info: r.checks.filter(c => c.status === 'info').map(c => ({ group: c.group, title: c.title, detail: c.detail ?? null })),
    market: p ? {
      dex: p.dexId, pair: p.pairAddress, priceUsd: p.priceUsd ? Number(p.priceUsd) : null, liquidityUsd: p.liquidity?.usd ?? null,
      marketCapUsd: p.marketCap ?? null, volume24hUsd: p.volume?.h24 ?? null, poolCreatedAt: p.pairCreatedAt ?? null, url: p.url,
    } : null,
    facts: r.facts ?? {},
    mode: a.mode,
    complete: a.mode === 'full' && !r.degraded,
    checkedAt: new Date(a.at).toISOString(),
    ageSeconds: Math.round((Date.now() - a.at) / 1000),
    links: { report: `${base}/t/${addr}`, map: `${base}/app/${addr}`, card: `${base}/og/${addr}.png` },
    disclaimer: 'Facts and a risk score, not financial advice.',
  };
}

export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL, base: string): Promise<boolean> {
  const path = url.pathname;
  if (!path.startsWith('/api/v1')) return false;
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return true; }

  const who = keyFrom(req)?.key ?? clientIp(req);
  if (!allow(who)) { json(res, 429, { error: 'Too many requests. Slow down to 60 a minute.' }); return true; }

  if (path === '/api/v1' || path === '/api/v1/') { json(res, 200, index(base)); return true; }
  if (path === '/api/v1/openapi.json') { json(res, 200, openapi(base)); return true; }

  if (path === '/api/v1/check') {
    const address = await resolveToken(url.searchParams.get('token') ?? url.searchParams.get('q') ?? '');
    if (!address) { json(res, 400, { error: 'Pass ?token=0x… (a token address or a DexScreener link).' }); return true; }
    const mode = url.searchParams.get('mode') === 'full' ? 'full' : 'quick';
    if (mode === 'quick') { json(res, 200, summary(await quickCheck(address), base)); return true; }
    await paidFull(req, res, address, who, `${base}/api/v1/check?token=${address}&mode=full`, base);
    return true;
  }

  if (path === '/api/v1/compare') {
    const [a, b] = await Promise.all([resolveToken(url.searchParams.get('a') ?? ''), resolveToken(url.searchParams.get('b') ?? '')]);
    if (!a || !b) { json(res, 400, { error: 'Pass ?a=0x…&b=0x…' }); return true; }
    const [x, y] = await Promise.all([quickCheck(a), quickCheck(b)]);
    const sa = summary(x, base), sb = summary(y, base);
    json(res, 200, { a: sa, b: sb, lowerRisk: sa.risk.score === sb.risk.score ? null : sa.risk.score < sb.risk.score ? a : b });
    return true;
  }

  if (path === '/api/v1/launches') {
    const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 500);
    const maxRisk = Number(url.searchParams.get('maxRisk') ?? 100);
    json(res, 200, { launches: launchesForApi(limit, maxRisk, base) });
    return true;
  }

  if (path === '/api/v1/pricing') { json(res, 200, pricing()); return true; }
  if (path === '/api/v1/accuracy') { json(res, 200, accuracySummary()); return true; }
  if (path === '/api/v1/accuracy/raw') {
    res.setHeader('content-disposition', 'attachment; filename="tell-accuracy.json"');
    json(res, 200, { ...accuracySummary(), rows: accuracyRows() });
    return true;
  }
  if (path === '/api/v1/stats') { json(res, 200, stats()); return true; }
  if (path === '/api/v1/token') {
    json(res, 200, {
      live: Boolean(config.tellToken), token: config.tellToken || null, chainId: 4663, launchpad: 'Pons (ponsfamily.com)',
      holderMin: config.holderMin, buybackShare: config.buybackShare, treasury: config.payTo || null,
      payments: paymentsEnabled(), priceFull: config.priceFull, revenue: revenue(), burned: await tellBurned(),
    });
    return true;
  }
  if (path === '/api/v1/proof') { json(res, 200, { ...proofSummary(), revenue: revenue(), treasury: config.payTo || null, payments: paymentsEnabled(), tell: await tellBurned() }); return true; }
  const pm = path.match(/^\/api\/v1\/proof\/(0x[a-fA-F0-9]{40})$/);
  if (pm) { json(res, 200, { token: getAddress(pm[1]), verdicts: proofFor(pm[1]) }); return true; }

  if (path === '/api/v1/keys') {
    const address = sessionAddress(req.headers.cookie);
    if (!address) { json(res, 401, { error: 'Sign in with your wallet on tell.markets first.' }); return true; }
    if (req.method === 'POST') { json(res, 200, { key: createKey(address, url.searchParams.get('label') ?? undefined), note: 'Shown once. Send it as "Authorization: Bearer <key>".' }); return true; }
    json(res, 200, { keys: keysOf(address) });
    return true;
  }

  json(res, 404, { error: 'Unknown endpoint. See /api/v1 for the list.' });
  return true;
}

/** Full check: free allowance, then free for holders, then x402. */
async function paidFull(req: IncomingMessage, res: ServerResponse, address: `0x${string}`, who: string, resource: string, base: string) {
  if (!paymentsEnabled() || await keyIsHolder(req)) return json(res, 200, summary(await fullCheck(address), base));

  const payment = readPayment(req);
  if (!payment && takeFreeFull(who)) {
    const used = fullUsed.get(who)?.n ?? 0;
    res.setHeader('x-free-full-checks-left', String(Math.max(0, config.freeFullPerDay - used)));
    return json(res, 200, summary(await fullCheck(address), base));
  }

  const reqs = requirements(resource, config.priceFull, 'Tell full risk check of a Robinhood Chain token');
  if (!payment) return sendPaymentRequired(res, reqs, `Free full checks used up (${config.freeFullPerDay}/day). Pay ${config.priceFull} USDG per check via x402, or use mode=quick.`);
  const v = await verifyPayment(payment, reqs);
  if (!v.ok) return sendPaymentRequired(res, reqs, v.reason);

  const answer = await fullCheck(address);
  const s = await settlePayment(payment, reqs);
  if (!s.ok) return sendPaymentRequired(res, reqs, s.reason);
  res.setHeader('x-payment-response', paymentResponseHeader(s.tx, s.payer));
  res.setHeader('payment-response', paymentResponseHeader(s.tx, s.payer));
  json(res, 200, summary(answer, base));
}

/** Live numbers for the homepage strip; cheap, no RPC. */
function stats() {
  const feed = launchFeed();
  const ms = recentCheckMs().sort((a, b) => a - b);
  const acc = accuracySummary();
  return {
    launches24h: feed.length,
    checked24h: feed.filter(l => l.score).length,
    medianCheckSeconds: ms.length ? Math.round(ms[Math.floor(ms.length / 2)] / 1000) : null,
    verdictsOnRecord: proofSummary().verdicts,
    accuracy: { tokens: acc.tokens, lift: acc.lift },
  };
}

/** Takes one free full check from the caller's daily allowance; false when it is used up. */
export function takeFreeFull(who: string): boolean {
  const day = new Date().toISOString().slice(0, 10);
  const used = fullUsed.get(who);
  const n = used?.day === day ? used.n : 0;
  if (n >= config.freeFullPerDay) return false;
  fullUsed.set(who, { day, n: n + 1 });
  return true;
}

export function launchesForApi(limit: number, maxRisk: number, base: string) {
  return launchFeed()
    .filter(l => l.score === undefined || l.score.value <= maxRisk)
    .slice(0, limit)
    .map(l => ({
      token: l.token, name: l.name ?? null, symbol: l.symbol ?? null, launchpad: l.launchpad, deployer: l.deployer,
      launchedAt: new Date(l.at).toISOString(),
      risk: l.score ? { score: l.score.value, label: l.score.label, level: level(l.score.value) } : null,
      verdict: l.verdict ?? null, holders: l.holders ?? null, liquidityUsd: l.liquidity ?? null, marketCapUsd: l.marketCap ?? null,
      checkedAt: l.checkedAt ? new Date(l.checkedAt).toISOString() : null, impostor: l.impostor,
      report: `${base}/t/${l.token}`,
    }));
}

export function pricing() {
  return {
    quick: { price: 0, note: 'contract + market, from cache when a full report is under an hour old' },
    full: {
      price: paymentsEnabled() ? config.priceFull : 0, currency: 'USDG', freePerDay: config.freeFullPerDay,
      payments: paymentsEnabled() ? { protocol: 'x402', scheme: 'exact', network: 'eip155:4663', asset: USDG, payTo: config.payTo } : 'off: full checks are free right now',
      holders: config.tellToken ? `free with an API key from a wallet holding ${config.holderMin.toLocaleString('en-US')} $TELL` : 'free with an API key once $TELL launches',
    },
  };
}

function index(base: string) {
  return {
    name: 'Tell API', version: 1, docs: `${base}/docs`, openapi: `${base}/api/v1/openapi.json`, mcp: `${base}/mcp`,
    endpoints: {
      'GET /api/v1/check?token=0x…&mode=quick|full': 'risk check of one token',
      'GET /api/v1/compare?a=0x…&b=0x…': 'two tokens side by side',
      'GET /api/v1/launches?limit=50&maxRisk=100': 'Pons launches of the last 24h with scores',
      'GET /api/v1/pricing': 'what is free and what costs USDG',
      'GET /api/v1/proof': 'verdict ledger and x402 revenue',
      'GET /api/v1/proof/0x…': 'recorded verdicts for one token with Merkle proofs',
      'GET /api/v1/accuracy': 'how tokens fared 2-7 days later, by the risk level Tell gave them',
      'GET /api/v1/accuracy/raw': 'every evaluated token, downloadable',
      'GET /api/v1/stats': 'live numbers: launches, checks, verdicts',
      'GET /api/v1/token': '$TELL: contract, buyback share, revenue, burns',
    },
    pricing: pricing(),
  };
}

function openapi(base: string) {
  const token = { name: 'token', in: 'query', required: true, schema: { type: 'string' }, description: '0x token address or DexScreener link' };
  return {
    openapi: '3.1.0',
    info: { title: 'Tell API', version: '1.0.0', description: 'Risk checks for tokens on Robinhood Chain. Full checks may answer 402 with x402 payment requirements (USDG, eip155:4663).' },
    servers: [{ url: base }],
    paths: {
      '/api/v1/check': { get: { summary: 'Check a token', parameters: [token, { name: 'mode', in: 'query', schema: { type: 'string', enum: ['quick', 'full'], default: 'quick' } }], responses: { 200: { description: 'Risk summary' }, 402: { description: 'x402 payment required (full mode)' } } } },
      '/api/v1/compare': { get: { summary: 'Compare two tokens', parameters: [{ name: 'a', in: 'query', required: true, schema: { type: 'string' } }, { name: 'b', in: 'query', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Both summaries' } } } },
      '/api/v1/launches': { get: { summary: 'Recent Pons launches', parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } }, { name: 'maxRisk', in: 'query', schema: { type: 'integer', default: 100 } }], responses: { 200: { description: 'Launch list' } } } },
      '/api/v1/pricing': { get: { summary: 'Pricing', responses: { 200: { description: 'Pricing' } } } },
      '/api/v1/proof': { get: { summary: 'Verdict ledger', responses: { 200: { description: 'Batches, roots, tx hashes, revenue' } } } },
      '/api/v1/proof/{token}': { get: { summary: 'Verdicts for a token', parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Leaves with Merkle proofs' } } } },
    },
  };
}

export function cors(res: ServerResponse) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type, authorization, x-api-key, x-payment, payment-signature, mcp-session-id, mcp-protocol-version');
  res.setHeader('access-control-expose-headers', 'x-payment-response, payment-response, payment-required, x-free-full-checks-left, mcp-session-id');
}

function allow(who: string) {
  const now = Date.now();
  const h = hits.get(who);
  if (!h || now - h.at > 60_000) { hits.set(who, { at: now, n: 1 }); return true; }
  return ++h.n <= RATE;
}

export function clientIp(req: IncomingMessage) {
  const fwd = req.headers['x-forwarded-for'];
  return (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
}
