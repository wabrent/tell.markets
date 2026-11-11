import { createHmac, randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { launchFeed } from '../launches.js';
import { JsonStore } from '../store.js';

/*
 * X: one "Launches today" post a day at X_DIGEST_HOUR (UTC). One post keeps the X API bill flat;
 * per-launch posts belong in the Telegram channel. Uses OAuth 1.0a user context (app key + the
 * account's access token), so it posts as the Tell account.
 */

const sent = new JsonStore<number>('x-posted.json', 1000);
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

function oauthHeader(method: string, url: string) {
  const p: Record<string, string> = {
    oauth_consumer_key: config.x.apiKey,
    oauth_nonce: randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: config.x.accessToken,
    oauth_version: '1.0',
  };
  // a JSON body is not part of the signature base string
  const params = Object.keys(p).sort().map(k => `${enc(k)}=${enc(p[k])}`).join('&');
  const base = `${method}&${enc(url)}&${enc(params)}`;
  p.oauth_signature = createHmac('sha1', `${enc(config.x.apiSecret)}&${enc(config.x.accessSecret)}`).update(base).digest('base64');
  return 'OAuth ' + Object.keys(p).sort().map(k => `${enc(k)}="${enc(p[k])}"`).join(', ');
}

export async function postToX(text: string) {
  const url = 'https://api.x.com/2/tweets';
  const res = await fetch(url, { method: 'POST', headers: { authorization: oauthHeader('POST', url), 'content-type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`X post failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return await res.json();
}

export function digestText(base: string) {
  const feed = launchFeed();
  const scored = feed.filter(l => l.score && (l.holders ?? 0) >= 25);
  const host = base.replace(/^https?:\/\//, '');
  const tag = (l: (typeof feed)[number]) => `$${(l.symbol ?? '?').slice(0, 12)} ${l.score!.value}`;
  const clean = [...scored].sort((a, b) => a.score!.value - b.score!.value).slice(0, 3);
  const loud = [...scored].sort((a, b) => b.score!.value - a.score!.value).filter(l => l.score!.value >= 60).slice(0, 3);
  const lines = [
    'Launches today on Robinhood Chain',
    `${feed.length.toLocaleString('en-US')} launched on Pons · ${feed.filter(l => l.score).length} checked`,
    '',
    clean.length ? `Quietest tells: ${clean.map(tag).join(' · ')}` : '',
    loud.length ? `Loudest tells: ${loud.map(tag).join(' · ')}` : '',
    '',
    `Scores 0-100, lower = fewer red flags. Not financial advice.`,
    `${host}/launches`,
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '');
  return lines.join('\n').slice(0, 280);
}

export function startX(base: string) {
  const x = config.x;
  if (!x.apiKey || !x.apiSecret || !x.accessToken || !x.accessSecret) return;
  console.log(`X digest on, daily at ${x.digestHour}:00 UTC`);
  setInterval(async () => {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    if (now.getUTCHours() !== x.digestHour || sent.get(day) || !launchFeed().some(l => l.score)) return;
    sent.set(day, Date.now());
    try { await postToX(digestText(base)); } catch (err) { console.error((err as Error).message); }
  }, 5 * 60_000);
}
