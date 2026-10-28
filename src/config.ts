import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT) || 3000,
  rpcUrl: process.env.RPC_URL || 'https://rpc.mainnet.chain.robinhood.com',
  bitqueryToken: process.env.BITQUERY_TOKEN ?? '',
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? '',
  deepseekKey: process.env.DEEPSEEK_API_KEY ?? '',
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
};
