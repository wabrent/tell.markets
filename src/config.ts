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
};
