// Smoke test for the agent API, MCP and x402 flow.  node scripts/smoke.mjs [baseUrl]
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';

const BASE = process.argv[2] || 'http://localhost:3100';
const HOOD = '0x45C83b37C5BAF4dad26f3845C28295e2DE010962';
let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failed++; };
const get = async (p, h = {}) => { const t = Date.now(); const r = await fetch(BASE + p, { headers: h }); return { r, ms: Date.now() - t, body: await r.text() }; };

// index + pricing + openapi + llms
{ const { r, body } = await get('/api/v1'); ok(r.status === 200 && JSON.parse(body).mcp, 'GET /api/v1 lists endpoints'); }
{ const { body } = await get('/api/v1/pricing'); ok(JSON.parse(body).full, 'GET /api/v1/pricing'); }
{ const { body } = await get('/api/v1/openapi.json'); ok(JSON.parse(body).openapi === '3.1.0', 'openapi.json'); }
{ const { r, body } = await get('/llms.txt'); ok(r.status === 200 && body.includes('/mcp'), 'llms.txt'); }
for (const p of ['/docs', '/proof', '/']) { const { r, body } = await get(p); ok(r.status === 200 && body.includes('</html>'), `page ${p}`); }

// quick check
{
  const { r, ms, body } = await get(`/api/v1/check?token=${HOOD}`);
  const j = JSON.parse(body);
  ok(r.status === 200 && typeof j.risk?.score === 'number', `quick check ${j.token?.symbol} score ${j.risk?.score} mode ${j.mode} in ${ms}ms`);
  ok(r.headers.get('access-control-allow-origin') === '*', 'CORS header');
}
{ const { r } = await get('/api/v1/check?token=nope'); ok(r.status === 400, 'bad token -> 400'); }

// x402: full check without payment -> 402 (when payments are on and the free allowance is 0)
const url = `/api/v1/check?token=${HOOD}&mode=full`;
const paymentsOn = typeof JSON.parse((await get('/api/v1/pricing')).body).full.payments === 'object';
if (!paymentsOn) {
  const { r, ms, body } = await get(url);
  ok(r.status === 200 && JSON.parse(body).mode === 'full', `payments off: full check free -> ${r.status}, score ${JSON.parse(body).risk?.score}, ${Math.round(ms / 1000)}s`);
}
const first = paymentsOn ? await get(url) : { r: { status: 402, headers: new Headers({ 'payment-required': 'skip' }) }, body: '{"error":"skipped: payments off"}' };
if (!paymentsOn) console.log('SKIP  x402 checks: payments are off on this server');
const req = paymentsOn && first.r.status === 402 ? JSON.parse(first.body).accepts?.[0] : undefined;
if (paymentsOn) {
  ok(first.r.status === 402 && req?.scheme === 'exact' && req?.network === 'eip155:4663', `full without payment -> ${first.r.status} ${JSON.parse(first.body).error ?? ''}`);
  ok(Boolean(first.r.headers.get('payment-required')), 'PAYMENT-REQUIRED header (v2)');
}

if (req) {
  const account = privateKeyToAccount(generatePrivateKey()); // holds no USDG
  const auth = { from: account.address, to: req.payTo, value: req.maxAmountRequired, validAfter: '0', validBefore: String(Math.floor(Date.now() / 1000) + 120), nonce: '0x' + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex') };
  const signature = await account.signTypedData({
    domain: { name: req.extra.name, version: req.extra.version, chainId: 4663, verifyingContract: req.asset },
    types: { TransferWithAuthorization: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }] },
    primaryType: 'TransferWithAuthorization',
    message: { ...auth, value: BigInt(auth.value), validAfter: 0n, validBefore: BigInt(auth.validBefore) },
  });
  const enc = p => Buffer.from(JSON.stringify(p)).toString('base64');
  const good = { x402Version: 1, scheme: 'exact', network: req.network, payload: { signature, authorization: auth } };
  { const { r, body } = await get(url, { 'X-PAYMENT': enc(good) }); ok(r.status === 402 && JSON.parse(body).error === 'insufficient_funds', `valid signature, empty wallet -> ${JSON.parse(body).error}`); }
  { const bad = structuredClone(good); bad.payload.authorization.value = '1'; const { body } = await get(url, { 'X-PAYMENT': enc(bad) }); ok(JSON.parse(body).error?.includes('value'), `underpaid -> ${JSON.parse(body).error}`); }
  { const bad = structuredClone(good); bad.payload.authorization.nonce = '0x' + '22'.repeat(32); const { body } = await get(url, { 'X-PAYMENT': enc(bad) }); ok(JSON.parse(body).error?.includes('signature'), `tampered -> ${JSON.parse(body).error}`); }
  { const bad = structuredClone(good); bad.payload.authorization.to = account.address; const { body } = await get(url, { 'X-PAYMENT': enc(bad) }); ok(JSON.parse(body).error?.includes('recipient'), `wrong recipient -> ${JSON.parse(body).error}`); }
}

// MCP
const mcp = async (method, params, id = 1) => {
  const r = await fetch(BASE + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { raw: t, status: r.status }; }
};
{
  const init = await mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } });
  ok(init.result?.serverInfo?.name === 'tell', `MCP initialize -> ${init.result?.serverInfo?.name ?? JSON.stringify(init).slice(0, 200)}`);
  const list = await mcp('tools/list', {}, 2);
  const names = list.result?.tools?.map(t => t.name) ?? [];
  ok(names.includes('check_token') && names.includes('recent_launches'), `MCP tools/list -> ${names.join(', ') || JSON.stringify(list).slice(0, 200)}`);
  const call = await mcp('tools/call', { name: 'check_token', arguments: { token: HOOD } }, 3);
  const txt = call.result?.content?.[0]?.text ?? '';
  ok(txt.includes('"risk"'), `MCP check_token -> ${txt.slice(0, 80).replace(/\s+/g, ' ')}`);
  const full = await mcp('tools/call', { name: 'check_token', arguments: { token: HOOD, mode: 'full' } }, 4);
  if (paymentsOn) ok(full.result?.isError && /x402|USDG/.test(full.result.content[0].text), 'MCP full past allowance -> pay instructions');
  else ok(full.result?.content?.[0]?.text?.includes('"mode": "full"'), 'MCP full check (payments off)');
}

// launches + proof
{ const { body } = await get('/api/v1/launches?limit=3'); ok(Array.isArray(JSON.parse(body).launches), 'launches'); }
{ const { body } = await get('/api/v1/proof'); const j = JSON.parse(body); ok('verdicts' in j && 'revenue' in j, `proof: ${j.verdicts} verdicts, ${j.pending} pending`); }

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
