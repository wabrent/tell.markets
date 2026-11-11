// Scrolls through each page and reports motion problems: errors, blocks or words left hidden.
import puppeteer from 'puppeteer';
const [base, ...paths] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
for (const path of paths) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
  await page.goto(base + path, { waitUntil: 'networkidle2', timeout: 90_000 });
  await new Promise(r => setTimeout(r, 1200));
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= h + 900; y += 350) { await page.evaluate(v => window.scrollTo(0, v), y); await new Promise(r => setTimeout(r, 110)); }
  await new Promise(r => setTimeout(r, 2200));
  const r = await page.evaluate(() => ({
    motion: document.documentElement.classList.contains('m-on'), lenis: document.documentElement.classList.contains('lenis'),
    reveal: document.querySelectorAll('[data-reveal]').length,
    hidden: [...document.querySelectorAll('[data-reveal]')].filter(e => getComputedStyle(e).opacity < 0.5 && !e.closest('[hidden]')).map(e => e.tagName + '.' + e.className).slice(0, 5),
    words: document.querySelectorAll('.m-split .mw').length,
    lowWords: [...document.querySelectorAll('.m-split .mw > span')].filter(s => s.getBoundingClientRect().top - s.parentElement.getBoundingClientRect().top > 4).length,
    walletBtn: (() => { const b = document.querySelector('[data-wallet] [data-in]'); return b ? getComputedStyle(b).opacity : 'n/a'; })(),
  }));
  console.log(path.padEnd(10), JSON.stringify(r), errors.length ? 'ERRORS: ' + errors.join(' | ') : 'ok');
  await page.close();
}
await browser.close();
