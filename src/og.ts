import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import type { Report } from './analyze.js';

// Share cards (og:image) for X, Telegram, Discord: 1200×630 PNG drawn from an SVG.
const ROOT = new URL('../assets/', import.meta.url);
const FONTS = ['InstrumentSerif-Regular.ttf', 'InstrumentSerif-Italic.ttf', 'JetBrainsMono.ttf', 'Inter.ttf']
  .map(f => fileURLToPath(new URL(`fonts/${f}`, ROOT)));
const STATUE = 'data:image/png;base64,' + readFileSync(new URL('statue-card.png', ROOT)).toString('base64');

const W = 1200, H = 630;
const TONE: Record<string, string> = { ok: '#4fb27a', mid: '#d8c24a', warn: '#e3a540', bad: '#ff5a5f' };
const tone = (v: number) => (v >= 80 ? 'bad' : v >= 60 ? 'warn' : v >= 30 ? 'mid' : 'ok');

const xml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

/** Greedy word wrap by character count; good enough for one font at one size. */
function wrap(text: string, perLine: number, maxLines: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > perLine && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    } else line = (line + ' ' + w).trim();
  }
  if (lines.length < maxLines && line) lines.push(line);
  const used = lines.join(' ').length;
  if (used < text.length - 1) lines[lines.length - 1] = lines[lines.length - 1].replace(/[\s,.;:]*\S*$/, '') + '…';
  return lines;
}

function frame(inner: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="glow" cx="0.78" cy="0.35" r="0.75"><stop offset="0" stop-color="#c41a22"/><stop offset="0.55" stop-color="#8e0c14"/><stop offset="1" stop-color="#4a050a"/></radialGradient>
    <linearGradient id="fade" x1="0" x2="1" y1="0" y2="0"><stop offset="0.38" stop-color="#8e0c14" stop-opacity="0.92"/><stop offset="0.62" stop-color="#8e0c14" stop-opacity="0"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <image href="${STATUE}" x="${W - 500}" y="-40" width="520" height="730" preserveAspectRatio="xMidYMid slice"/>
  <rect width="${W}" height="${H}" fill="url(#fade)"/>
  ${inner}
</svg>`;
}

const mono = (x: number, y: number, s: string, size = 18, fill = '#ffd9da', spacing = 3) =>
  `<text x="${x}" y="${y}" font-family="JetBrains Mono" font-size="${size}" letter-spacing="${spacing}" fill="${fill}">${xml(s)}</text>`;

export function tokenCard(r: Report): Buffer {
  const sym = r.token.symbol ? `$${r.token.symbol}` : `${r.token.address.slice(0, 6)}…${r.token.address.slice(-4)}`;
  const t = tone(r.score.value);
  const color = TONE[t];
  const verdict = wrap(r.verdict, 46, 3);
  const label = r.score.label.toUpperCase();
  const pillW = label.length * 13 + 36;
  const inner = `
  ${mono(70, 82, 'TELL.MARKETS  ·  RISK REPORT')}
  <text x="70" y="190" font-family="Instrument Serif" font-size="104" fill="#fff">${xml(sym.slice(0, 14))}</text>
  ${r.token.name ? `<text x="72" y="232" font-family="Inter" font-size="24" fill="#ffc9cb">${xml(r.token.name.slice(0, 40))}</text>` : ''}
  <text x="70" y="372" font-family="Instrument Serif" font-size="150" fill="#fff">${r.score.value}</text>
  <text x="${70 + String(r.score.value).length * 70 + 16}" y="372" font-family="Inter" font-size="26" fill="#ffc9cb">/ 100 risk</text>
  <rect x="70" y="396" width="${pillW}" height="38" rx="19" fill="none" stroke="${color}" stroke-width="2"/>
  <text x="${70 + pillW / 2}" y="422" text-anchor="middle" font-family="JetBrains Mono" font-size="17" letter-spacing="2" fill="${color}">${xml(label)}</text>
  ${verdict.map((l, i) => `<text x="70" y="${488 + i * 38}" font-family="Instrument Serif" font-size="32" fill="#fff">${xml(l)}</text>`).join('')}
  ${mono(70, 600, 'NOT FINANCIAL ADVICE', 13, '#ffb3b5', 2)}`;
  return render(frame(inner));
}

export function siteCard(): Buffer {
  const inner = `
  ${mono(70, 120, 'LAUNCH CHECKS ON ROBINHOOD CHAIN')}
  <text x="70" y="270" font-family="Instrument Serif" font-size="120" fill="#fff">Read the tell</text>
  <text x="70" y="390" font-family="Instrument Serif" font-size="120" fill="#fff">before you <tspan font-style="italic">buy.</tspan></text>
  <text x="72" y="470" font-family="Inter" font-size="26" fill="#ffc9cb">Contract, holders, deployer and website in one risk score.</text>
  ${mono(70, 560, 'TELL.MARKETS')}`;
  return render(frame(inner));
}

function render(svg: string): Buffer {
  return new Resvg(svg, {
    font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Inter' },
    fitTo: { mode: 'width', value: W },
  }).render().asPng();
}
