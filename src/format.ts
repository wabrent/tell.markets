import type { Report } from './analyze.js';
import { short } from './checks/contract.js';
import type { Group, Status } from './checks/types.js';

const GROUPS: { id: Group; title: string }[] = [
  { id: 'contract', title: '📜 Contract' },
  { id: 'holders', title: '👥 Holders' },
  { id: 'deployer', title: '🧑‍💻 Deployer' },
  { id: 'website', title: '🌐 Website & socials' },
  { id: 'market', title: '📈 Market' },
];

const ICON: Record<Status, string> = { ok: '✅', warn: '⚠️', bad: '❌', info: '▫️' };

/** Report as lightly marked-up HTML text. */
export function formatReport(r: Report): string {
  const sym = r.token.symbol ? `$${esc(r.token.symbol)}` : short(r.token.address);
  const lines = [
    `${r.score.emoji} <b>${sym}</b> · risk <b>${r.score.value}/100</b> · ${r.score.label}`,
    `<code>${r.token.address}</code>`,
    '',
    `<b>${r.aiVerdict ? 'AI verdict' : 'Verdict'}:</b> ${esc(r.verdict)}`,
  ];

  for (const g of GROUPS) {
    const items = r.checks.filter(c => c.group === g.id);
    if (!items.length) continue;
    lines.push('', `<b>${g.title}</b>`);
    for (const c of items) {
      lines.push(`${ICON[c.status]} ${esc(c.title)}${c.detail ? ` — <i>${esc(c.detail)}</i>` : ''}`);
    }
  }

  lines.push('', `<i>Checked in ${(r.ms / 1000).toFixed(1)}s.</i>`);
  lines.push('<i>Not financial advice.</i>');
  return lines.join('\n');
}

/** Same report as plain text, for the CLI. */
export function formatPlain(r: Report): string {
  return formatReport(r).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
