import { randomBytes } from 'node:crypto';
import { erc20Abi, getAddress, isAddress, verifyMessage, type Hex } from 'viem';
import { config } from './config.js';
import { client, withBackoff } from './sources/rpc.js';
import { JsonStore } from './store.js';

// Sign-in with a wallet: the user signs a plain message (no transaction, no gas), we check the
// signature and remember the address in a session cookie. $TELL holdings unlock unlimited checks.
const NONCE_MS = 10 * 60_000;
const SESSION_MS = 30 * 24 * 3600_000;

const nonces = new Map<string, number>();
const sessions = new JsonStore<{ address: string; at: number }>('sessions.json', 20_000);

export function newNonce() {
  const n = randomBytes(16).toString('hex');
  nonces.set(n, Date.now());
  for (const [k, t] of nonces) if (Date.now() - t > NONCE_MS) nonces.delete(k);
  return n;
}

export const signInMessage = (address: string, nonce: string) =>
  `Sign in to Tell (tell.markets)\n\nThis only proves you own this wallet. It costs nothing and sends no transaction.\n\nAddress: ${address}\nNonce: ${nonce}`;

export async function verify(address: string, nonce: string, signature: Hex): Promise<string | undefined> {
  if (!isAddress(address) || !nonces.has(nonce)) return undefined;
  nonces.delete(nonce); // single use
  const ok = await verifyMessage({ address: getAddress(address), message: signInMessage(getAddress(address), nonce), signature }).catch(() => false);
  if (!ok) return undefined;
  const sid = randomBytes(24).toString('hex');
  sessions.set(sid, { address: getAddress(address), at: Date.now() });
  return sid;
}

export function sessionAddress(cookie: string | undefined): string | undefined {
  const sid = cookie?.match(/(?:^|;\s*)tell_sid=([a-f0-9]{48})/)?.[1];
  const s = sid ? sessions.get(sid) : undefined;
  return s && Date.now() - s.at < SESSION_MS ? s.address : undefined;
}

export function signOut(cookie: string | undefined) {
  const sid = cookie?.match(/(?:^|;\s*)tell_sid=([a-f0-9]{48})/)?.[1];
  if (sid) sessions.set(sid, { address: '', at: 0 });
}

const balances = new Map<string, { at: number; holds: number }>();

/** $TELL held by this address (in whole tokens), cached for 5 minutes. 0 until the token exists. */
export async function tellBalance(address: string): Promise<number> {
  if (!config.tellToken) return 0;
  const hit = balances.get(address);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.holds;
  const [raw, decimals] = await Promise.all([
    withBackoff(() => client.readContract({ address: config.tellToken as Hex, abi: erc20Abi, functionName: 'balanceOf', args: [address as Hex] })),
    withBackoff(() => client.readContract({ address: config.tellToken as Hex, abi: erc20Abi, functionName: 'decimals' })),
  ]);
  const holds = Number(raw / 10n ** BigInt(Math.max(decimals - 2, 0))) / 100;
  balances.set(address, { at: Date.now(), holds });
  return holds;
}

export async function isHolder(address: string | undefined) {
  if (!address || !config.tellToken) return false;
  return (await tellBalance(address).catch(() => 0)) >= config.holderMin;
}
