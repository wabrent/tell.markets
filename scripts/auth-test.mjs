// Walks the wallet sign-in exactly like the browser does, with a throwaway key.
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
const BASE = process.argv[2] || 'https://tell.markets';
const acct = privateKeyToAccount(generatePrivateKey());
const n = await (await fetch(`${BASE}/api/auth/nonce?address=${acct.address.toLowerCase()}`)).json();
console.log('nonce ok:', Boolean(n.nonce));
const signature = await acct.signMessage({ message: n.message });
const v = await fetch(`${BASE}/api/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: acct.address.toLowerCase(), nonce: n.nonce, signature }) });
const cookie = v.headers.get('set-cookie');
console.log('verify', v.status, await v.text());
console.log('cookie:', cookie?.replace(/tell_sid=[a-f0-9]+/, 'tell_sid=…'));
const me = await (await fetch(`${BASE}/api/me`, { headers: { cookie: cookie?.split(';')[0] ?? '' } })).json();
console.log('me:', me.address === acct.address ? 'signed in' : 'NOT signed in', me.address);
