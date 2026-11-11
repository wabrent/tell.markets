// Full checks of real Pons projects through the site endpoint; prints the website findings.
const BASE = process.argv[2] || 'http://localhost:3100';
const tokens = { TIDE: '0x5dd89189769deB28E1e24fB8623e28856B6B5300', LETRO: '0xa2753fd0bc86b8ceb55ffd2698679c7f214785f1', KYTE: '0x072D88c2F31F568C0F4B8F613692eB489541Ed45' };
await Promise.all(Object.entries(tokens).map(async ([name, t]) => {
  const started = Date.now();
  const r = await (await fetch(`${BASE}/api/check?q=${t}`)).json();
  const lines = (r.checks ?? []).filter(c => c.group === 'website').map(c => `   [${c.status}] ${c.title}${c.detail ? ' — ' + c.detail : ''}`);
  console.log(`\n${name}: ${r.score?.value}/100 ${r.score?.label} (${Math.round((Date.now() - started) / 1000)}s)  burned ${r.facts?.burnedPct ?? '-'}%\n verdict: ${r.verdict}\n${lines.join('\n')}`);
}));
