import type { Report } from '../analyze.js';
import { resolveToken } from '../analyze.js';
import { summary } from '../api.js';
import { config } from '../config.js';
import { events } from '../events.js';
import { launchFeed } from '../launches.js';
import { quickCheck } from '../quick.js';
import { JsonStore } from '../store.js';

/*
 * Telegram: a bot that answers /check 0x… (or any message with an address) and, when a channel is
 * set, posts each Pons launch that got real traction once its full check is done.
 */

const API = () => `https://api.telegram.org/bot${config.telegramToken}`;
/** Launches with fewer holders than this are not worth a channel post; keeps the feed readable. */
const MIN_HOLDERS = Number(process.env.TELEGRAM_MIN_HOLDERS) || 25;
const posted = new JsonStore<number>('telegram-posted.json', 20_000);

async function call(method: string, body: Record<string, unknown>) {
  const res = await fetch(`${API()}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(70_000) });
  const data = await res.json() as { ok: boolean; result?: any; description?: string };
  if (!data.ok) throw new Error(`telegram ${method}: ${data.description}`);
  return data.result;
}

const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));

export function card(r: Report, base: string, mode: 'quick' | 'full' = 'full') {
  const s = summary({ report: r, at: Date.now(), mode }, base);
  const sym = s.token.symbol ? `$${esc(s.token.symbol)}` : 'Token';
  const flags = s.flags.slice(0, 4).map(f => `${f.severity === 'bad' ? '🔴' : '🟠'} ${esc(f.title)}`).join('\n');
  const ok = s.passed.slice(0, 3).map(p => `🟢 ${esc(p.title)}`).join('\n');
  return [
    `${r.score.emoji} <b>${sym}</b> · risk <b>${s.risk.score}/100</b> · ${esc(s.risk.label)}`,
    `<code>${s.token.address}</code>`,
    '',
    esc(s.verdict),
    '',
    flags, ok,
    '',
    `<a href="${s.links.report}">Full report</a> · <a href="${s.links.map}">Token map</a>${mode === 'quick' ? '\n<i>Quick check: contract and market. The full check runs in the background.</i>' : ''}`,
    '<i>Not financial advice.</i>',
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}

async function reply(chatId: number, text: string) {
  await call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } }).catch(err => console.error(err.message));
}

async function onMessage(msg: { chat: { id: number }; text?: string }, base: string) {
  const t = msg.text?.trim() ?? '';
  if (/^\/(start|help)/.test(t)) {
    return reply(msg.chat.id, 'Send a Robinhood Chain token address or DexScreener link, or use /check 0x…\n/launches — newest Pons launches with scores.\n\nTell reads the contract, holders, deployer, website and market and returns one risk score. Not financial advice.');
  }
  if (/^\/launches/.test(t)) {
    const rows = launchFeed().filter(l => l.score).slice(0, 10)
      .map(l => `${l.score!.emoji} <b>$${esc(l.symbol ?? '?')}</b> ${l.score!.value}/100 — <a href="${base}/t/${l.token}">report</a>`);
    return reply(msg.chat.id, rows.length ? `<b>Latest checked Pons launches</b>\n${rows.join('\n')}` : 'No checked launches yet. Try again in a few minutes.');
  }
  if (!/0x[a-fA-F0-9]{40}|0x[a-fA-F0-9]{64}|dexscreener\.com/.test(t)) {
    if (t.startsWith('/check')) return reply(msg.chat.id, 'Usage: /check 0x… (token address or DexScreener link)');
    return;
  }
  const address = await resolveToken(t);
  if (!address) return reply(msg.chat.id, 'No token found in that message.');
  await call('sendChatAction', { chat_id: msg.chat.id, action: 'typing' }).catch(() => {});
  const a = await quickCheck(address).catch(() => undefined);
  if (!a) return reply(msg.chat.id, 'Could not check this token right now. Try again in a minute.');
  return reply(msg.chat.id, card(a.report, base, a.mode));
}

export function startTelegram(base: string) {
  if (!config.telegramToken) return;
  let offset = 0;
  const loop = async () => {
    try {
      const updates = await call('getUpdates', { offset, timeout: 50, allowed_updates: ['message'] }) as { update_id: number; message?: any }[];
      for (const u of updates) {
        offset = u.update_id + 1;
        if (u.message) onMessage(u.message, base).catch(err => console.error('telegram message failed', err.message));
      }
      setTimeout(loop, 100);
    } catch (err) {
      console.error('telegram poll failed', (err as Error).message);
      setTimeout(loop, 10_000);
    }
  };
  loop();
  console.log('Telegram bot on');

  if (config.telegramChannel) {
    events.on('report', r => {
      const token = r.token.address.toLowerCase();
      if (posted.get(token) || (r.facts.holders ?? 0) < MIN_HOLDERS) return;
      if (!launchFeed().some(l => l.token === token)) return; // only fresh Pons launches
      posted.set(token, Date.now());
      call('sendMessage', { chat_id: config.telegramChannel, text: card(r, base), parse_mode: 'HTML', link_preview_options: { url: `${base}/t/${r.token.address}`, prefer_large_media: true } })
        .catch(err => console.error('telegram channel post failed', err.message));
    });
  }
}
