import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { resolveToken } from './analyze.js';
import { clientIp, cors, launchesForApi, pricing, summary, takeFreeFull } from './api.js';
import { config } from './config.js';
import { keyFrom, keyIsHolder } from './keys.js';
import { proofFor, proofSummary } from './proof.js';
import { fullCheck, quickCheck } from './quick.js';
import { paymentsEnabled } from './x402.js';

/*
 * Remote MCP server at /mcp (Streamable HTTP, stateless: a fresh server per request).
 * Any MCP client - Claude, Cursor, a trading agent - can call Tell's checks as tools.
 */

const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 1) }] });
const fail = (msg: string) => ({ content: [{ type: 'text' as const, text: msg }], isError: true });

function build(req: IncomingMessage, base: string) {
  const server = new McpServer({ name: 'tell', version: '1.0.0' }, {
    instructions: 'Tell checks tokens on Robinhood Chain (chain id 4663) for rug-pull and scam risk. Call check_token before buying a token you have not seen before. Scores: 0-29 low, 30-59 medium, 60-79 caution, 80-100 high risk. Results are facts and a risk score, not financial advice.',
  });
  const who = keyFrom(req)?.key ?? clientIp(req);

  server.registerTool('check_token', {
    title: 'Check a token',
    description: 'Risk check of one Robinhood Chain token. mode "quick" (default, free, ~3s): contract powers and market. mode "full" (~30s): adds holders, deployer history, website and AI review. Returns score 0-100, level, red flags and a one-line verdict.',
    inputSchema: {
      token: z.string().describe('Token contract address (0x…) or a DexScreener link'),
      mode: z.enum(['quick', 'full']).optional().describe('quick (default) or full'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ token, mode }) => {
    const address = await resolveToken(token);
    if (!address) return fail('No token address found. Pass a 0x… address or a DexScreener link.');
    if (mode !== 'full') return text(summary(await quickCheck(address), base));
    if (paymentsEnabled() && !(await keyIsHolder(req)) && !takeFreeFull(who)) {
      return fail(`Free full checks for today are used up (${config.freeFullPerDay}). Use mode "quick", pay ${config.priceFull} USDG per full check over x402 at ${base}/api/v1/check?token=${address}&mode=full, or connect with an API key from a $TELL-holding wallet.`);
    }
    return text(summary(await fullCheck(address), base));
  });

  server.registerTool('compare_tokens', {
    title: 'Compare two tokens',
    description: 'Quick risk check of two tokens side by side; says which one carries less risk.',
    inputSchema: { a: z.string().describe('First token 0x…'), b: z.string().describe('Second token 0x…') },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ a, b }) => {
    const [x, y] = await Promise.all([resolveToken(a), resolveToken(b)]);
    if (!x || !y) return fail('Both a and b must be token addresses or DexScreener links.');
    const [sa, sb] = (await Promise.all([quickCheck(x), quickCheck(y)])).map(r => summary(r, base));
    return text({ a: sa, b: sb, lowerRisk: sa.risk.score === sb.risk.score ? null : sa.risk.score < sb.risk.score ? x : y });
  });

  server.registerTool('recent_launches', {
    title: 'Recent launches',
    description: 'Tokens launched on the Pons launchpad in the last 24 hours, newest first, with risk scores where checked.',
    inputSchema: {
      limit: z.number().int().min(1).max(200).optional().describe('How many (default 20)'),
      max_risk: z.number().int().min(0).max(100).optional().describe('Only launches scored at or below this'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ limit, max_risk }) => text(launchesForApi(limit ?? 20, max_risk ?? 100, base)));

  server.registerTool('verdict_proof', {
    title: 'Verdict proof',
    description: 'Recorded Tell verdicts for a token with Merkle proofs against the hourly roots anchored on Robinhood Chain. Without a token: ledger summary.',
    inputSchema: { token: z.string().optional().describe('Token 0x… (optional)') },
    annotations: { readOnlyHint: true },
  }, async ({ token }) => {
    if (!token) return text(proofSummary());
    const address = await resolveToken(token);
    return address ? text({ token: address, verdicts: proofFor(address) }) : fail('Not a token address.');
  });

  server.registerTool('pricing', {
    title: 'Pricing',
    description: 'What is free, what costs USDG over x402, and how $TELL holders get free full checks.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => text(pricing()));

  return server;
}

export async function handleMcp(req: IncomingMessage, res: ServerResponse, base: string) {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.method !== 'POST') {
    // stateless server: no standalone SSE stream to resume
    res.writeHead(405, { 'content-type': 'application/json', allow: 'POST' });
    return res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Use POST. Tell MCP is stateless (Streamable HTTP).' }, id: null }));
  }
  const server = build(req, base);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}
