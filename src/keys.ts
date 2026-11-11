import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { isHolder } from './auth.js';
import { JsonStore } from './store.js';

/*
 * API keys for agents. A key is created by someone signed in with their wallet, so it belongs to
 * that address: while the address holds enough $TELL, full checks through the key are free.
 */
const keys = new JsonStore<{ address: string; at: number; label?: string }>('api-keys.json', 50_000);

export function createKey(address: string, label?: string) {
  const key = 'tell_' + randomBytes(20).toString('hex');
  keys.set(key, { address, at: Date.now(), label: label?.slice(0, 40) });
  return key;
}

export function keysOf(address: string) {
  return keys.entries().filter(([, v]) => v.address === address).map(([k, v]) => ({ key: k.slice(0, 9) + '…' + k.slice(-4), at: v.at, label: v.label }));
}

export function keyFrom(req: IncomingMessage): { key: string; address: string } | undefined {
  const auth = req.headers.authorization?.match(/^Bearer\s+(tell_[a-f0-9]{40})$/)?.[1];
  const raw = auth ?? (req.headers['x-api-key'] as string | undefined);
  const k = raw && /^tell_[a-f0-9]{40}$/.test(raw) ? keys.get(raw) : undefined;
  return k && raw ? { key: raw, address: k.address } : undefined;
}

export async function keyIsHolder(req: IncomingMessage) {
  const k = keyFrom(req);
  return k ? isHolder(k.address) : false;
}
