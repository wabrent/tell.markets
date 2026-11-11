import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT) || 3000,
  /** Public address of the site, for share-card links. Falls back to the request's host. */
  publicUrl: (process.env.PUBLIC_URL ?? '').replace(/\/$/, ''),
  rpcUrl: process.env.RPC_URL || 'https://rpc.mainnet.chain.robinhood.com',
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? '',
  deepseekKey: process.env.DEEPSEEK_API_KEY ?? '',
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
  /** $TELL contract once it launches; empty keeps holder perks switched off. */
  tellToken: (process.env.TELL_TOKEN ?? '').toLowerCase(),
  /** Whole $TELL tokens needed for unlimited checks. */
  holderMin: Number(process.env.TELL_HOLDER_MIN) || 100_000,
  /** Checks per day without $TELL. 0 means no limit (the default until the token exists). */
  freeChecksPerDay: Number(process.env.FREE_CHECKS_PER_DAY) || 0,
  /**
   * Background checks of new Pons launches for the /launches feed. Needs a long-running server,
   * so it is off on Vercel unless LAUNCH_WATCHER=on is set explicitly.
   */
  launchWatcher: process.env.LAUNCH_WATCHER ? process.env.LAUNCH_WATCHER !== 'off' : !process.env.VERCEL,

  // ---------- agent API ----------
  /** Full checks a day per caller through /api/v1 and MCP before payment is asked for. */
  freeFullPerDay: num(process.env.FREE_FULL_PER_DAY, 5),

  // ---------- x402 payments (USDG on Robinhood Chain) ----------
  /** Treasury that receives payments. Empty switches payments off: everything stays free. */
  payTo: (process.env.X402_PAY_TO ?? '').toLowerCase(),
  /** Price of a full check in USDG. */
  priceFull: num(process.env.X402_PRICE_FULL, 0.03),
  /** Key of a wallet that only holds gas ETH; it submits the signed USDG transfers. */
  settlerKey: process.env.X402_SETTLER_KEY ?? '',
  /** Alternative to a settler key: an x402 facilitator with /verify and /settle. */
  facilitatorUrl: (process.env.X402_FACILITATOR_URL ?? '').replace(/\/$/, ''),

  // ---------- proof ledger ----------
  /** Key that anchors the hourly verdict root on-chain (a 0-value tx to itself). Defaults to the settler. */
  proofKey: process.env.PROOF_KEY || process.env.X402_SETTLER_KEY || '',

  // ---------- bots ----------
  telegramToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  /** Channel (@name or numeric id) that gets a post for each checked launch. */
  telegramChannel: process.env.TELEGRAM_CHANNEL ?? '',
  x: {
    apiKey: process.env.X_API_KEY ?? '',
    apiSecret: process.env.X_API_SECRET ?? '',
    accessToken: process.env.X_ACCESS_TOKEN ?? '',
    accessSecret: process.env.X_ACCESS_SECRET ?? '',
    /** UTC hour of the daily "Launches today" post. */
    digestHour: num(process.env.X_DIGEST_HOUR, 18),
  },
};

function num(v: string | undefined, fallback: number) {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : fallback;
}
