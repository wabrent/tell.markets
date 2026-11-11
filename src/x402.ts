import type { IncomingMessage, ServerResponse } from 'node:http';
import { createWalletClient, erc20Abi, getAddress, http, isAddress, parseAbi, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { config } from './config.js';
import { client, robinhoodChain } from './sources/rpc.js';
import { JsonStore } from './store.js';

/*
 * x402: an agent pays per request in USDG, no account needed.
 *   1. Request without payment -> 402 + what to pay (scheme "exact", USDG on eip155:4663).
 *   2. Agent signs an EIP-3009 transferWithAuthorization for that amount and retries with the
 *      signed payload in the X-PAYMENT (v1) or PAYMENT-SIGNATURE (v2) header.
 *   3. We verify the signature and balance, do the work, then submit the transfer on-chain
 *      (our settler wallet pays the gas) and answer with X-PAYMENT-RESPONSE.
 * USDG on Robinhood Chain supports EIP-3009 (checked on mainnet 2026-11-10), so no Permit2 detour.
 */

export const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168' as const;
export const NETWORK = 'eip155:4663';
const USDG_DOMAIN = { name: 'Global Dollar', version: '1', chainId: 4663, verifyingContract: USDG } as const;
const TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
  ],
} as const;
const usdgAbi = parseAbi([
  'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature)',
  'function authorizationState(address authorizer, bytes32 nonce) view returns (bool)',
]);

export const paymentsEnabled = () => Boolean(config.payTo && isAddress(config.payTo) && (config.settlerKey || config.facilitatorUrl));

export interface Requirements {
  scheme: 'exact';
  network: string;
  maxAmountRequired: string;
  amount: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: { name: string; version: string };
}

export function requirements(resource: string, priceUsd: number, description: string): Requirements {
  const atomic = String(Math.round(priceUsd * 1e6)); // USDG has 6 decimals
  return {
    scheme: 'exact', network: NETWORK, maxAmountRequired: atomic, amount: atomic, resource, description,
    mimeType: 'application/json', payTo: getAddress(config.payTo), maxTimeoutSeconds: 120, asset: USDG,
    extra: { name: USDG_DOMAIN.name, version: USDG_DOMAIN.version },
  };
}

/** The 402 answer. Body is x402 v1; the PAYMENT-REQUIRED header carries the same for v2 clients. */
export function sendPaymentRequired(res: ServerResponse, req: Requirements, error = 'Payment required') {
  const body = { x402Version: 1, error, accepts: [req] };
  res.writeHead(402, {
    'content-type': 'application/json; charset=utf-8',
    'payment-required': Buffer.from(JSON.stringify({ ...body, x402Version: 2 })).toString('base64'),
    'access-control-expose-headers': 'payment-required, x-payment-response, payment-response',
  });
  res.end(JSON.stringify(body));
}

interface Authorization { from: Hex; to: Hex; value: string; validAfter: string; validBefore: string; nonce: Hex }
export interface Payment { x402Version: number; scheme: string; network: string; payload: { signature: Hex; authorization: Authorization } }

export function readPayment(req: IncomingMessage): Payment | undefined {
  const raw = req.headers['x-payment'] ?? req.headers['payment-signature'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return undefined;
  try {
    const p = JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
    // v2 nests the scheme under "accepted"
    if (!p.scheme && p.accepted) { p.scheme = p.accepted.scheme; p.network = p.accepted.network; }
    return p?.payload?.authorization && p?.payload?.signature ? p as Payment : undefined;
  } catch { return undefined; }
}

const usedNonces = new Set<string>();

/** Everything that can be checked before doing the work. */
export async function verifyPayment(p: Payment, r: Requirements): Promise<{ ok: true; payer: Hex } | { ok: false; reason: string }> {
  if (config.facilitatorUrl) return facilitator('verify', p, r).then(v => v.isValid ? { ok: true as const, payer: (v.payer ?? p.payload.authorization.from) as Hex } : { ok: false as const, reason: v.invalidReason ?? 'rejected by facilitator' });

  const a = p.payload.authorization;
  if (p.scheme !== 'exact') return { ok: false, reason: 'unsupported_scheme' };
  if (p.network !== NETWORK && p.network !== 'robinhood') return { ok: false, reason: 'invalid_network' };
  if (!isAddress(a.from) || !isAddress(a.to)) return { ok: false, reason: 'invalid_payload' };
  if (a.to.toLowerCase() !== r.payTo.toLowerCase()) return { ok: false, reason: 'invalid_exact_evm_payload_recipient_mismatch' };
  if (BigInt(a.value) < BigInt(r.maxAmountRequired)) return { ok: false, reason: 'invalid_exact_evm_payload_authorization_value' };
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (BigInt(a.validBefore) < now + 6n) return { ok: false, reason: 'invalid_exact_evm_payload_authorization_valid_before' };
  if (BigInt(a.validAfter) > now) return { ok: false, reason: 'invalid_exact_evm_payload_authorization_valid_after' };
  if (usedNonces.has(a.nonce.toLowerCase())) return { ok: false, reason: 'nonce_already_used' };

  const sigOk = await client.verifyTypedData({
    address: a.from, domain: USDG_DOMAIN, types: TYPES, primaryType: 'TransferWithAuthorization', signature: p.payload.signature,
    message: { from: a.from, to: a.to, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce },
  }).catch(() => false);
  if (!sigOk) return { ok: false, reason: 'invalid_exact_evm_payload_signature' };

  const [used, balance] = await Promise.all([
    client.readContract({ address: USDG, abi: usdgAbi, functionName: 'authorizationState', args: [a.from, a.nonce] }),
    client.readContract({ address: USDG, abi: erc20Abi, functionName: 'balanceOf', args: [a.from] }),
  ]);
  if (used) return { ok: false, reason: 'nonce_already_used' };
  if (balance < BigInt(a.value)) return { ok: false, reason: 'insufficient_funds' };
  return { ok: true, payer: a.from };
}

const payments = new JsonStore<{ at: number; payer: string; amount: string; tx: string; resource: string }>('payments.json', 100_000);

/** Submits the signed transfer. Called after the work succeeded, so a failed check costs nothing. */
export async function settlePayment(p: Payment, r: Requirements): Promise<{ ok: true; tx: Hex; payer: Hex } | { ok: false; reason: string }> {
  const a = p.payload.authorization;
  const nonce = a.nonce.toLowerCase();
  if (usedNonces.has(nonce)) return { ok: false, reason: 'nonce_already_used' };
  usedNonces.add(nonce);
  try {
    let tx: Hex;
    if (config.facilitatorUrl) {
      const s = await facilitator('settle', p, r);
      if (!s.success || !s.transaction) throw new Error(s.errorReason ?? 'facilitator could not settle');
      tx = s.transaction as Hex;
    } else {
      const wallet = settler();
      tx = await wallet.writeContract({
        address: USDG, abi: usdgAbi, functionName: 'transferWithAuthorization',
        args: [a.from, a.to, BigInt(a.value), BigInt(a.validAfter), BigInt(a.validBefore), a.nonce, p.payload.signature],
      });
      const receipt = await client.waitForTransactionReceipt({ hash: tx, timeout: 60_000 });
      if (receipt.status !== 'success') throw new Error('transfer reverted');
    }
    payments.set(tx, { at: Date.now(), payer: a.from.toLowerCase(), amount: a.value, tx, resource: r.resource });
    return { ok: true, tx, payer: a.from };
  } catch (err) {
    usedNonces.delete(nonce);
    console.error('x402 settle failed', (err as Error).message);
    return { ok: false, reason: 'settle_failed' };
  }
}

export function paymentResponseHeader(tx: Hex, payer: Hex) {
  return Buffer.from(JSON.stringify({ success: true, transaction: tx, network: NETWORK, payer })).toString('base64');
}

/** Totals for the /proof page. */
export function revenue() {
  const all = payments.values();
  const total = all.reduce((s, p) => s + BigInt(p.amount), 0n);
  const day = Date.now() - 24 * 3600_000;
  const last = all.filter(p => p.at > day);
  return {
    payments: all.length,
    usdg: Number(total) / 1e6,
    payers: new Set(all.map(p => p.payer)).size,
    last24h: { payments: last.length, usdg: Number(last.reduce((s, p) => s + BigInt(p.amount), 0n)) / 1e6 },
    recent: all.slice(-20).reverse().map(p => ({ at: p.at, payer: p.payer, usdg: Number(p.amount) / 1e6, tx: p.tx })),
  };
}

let wallet: ReturnType<typeof makeWallet> | undefined;
const makeWallet = (key: string) => createWalletClient({ account: privateKeyToAccount(key as Hex), chain: robinhoodChain, transport: http(config.rpcUrl) });
function settler() { return (wallet ??= makeWallet(config.settlerKey)); }

async function facilitator(op: 'verify' | 'settle', p: Payment, r: Requirements) {
  const res = await fetch(`${config.facilitatorUrl}/${op}`, {
    method: 'POST', signal: AbortSignal.timeout(60_000),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ x402Version: p.x402Version ?? 1, paymentPayload: p, paymentRequirements: r }),
  });
  return await res.json() as { isValid?: boolean; invalidReason?: string; payer?: string; success?: boolean; transaction?: string; errorReason?: string };
}
