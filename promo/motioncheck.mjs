// Checks the motion layer: libraries loaded, no errors, nothing left hidden after scrolling through.
import puppeteer from 'puppeteer';
const url = process.argv[2];
const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('requestfailed', r => errors.push('failed: ' + r.url()));
await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 });
console.log('libs:', await page.evaluate(() => ({ gsap: !!window.gsap, st: !!window.ScrollTrigger, lenis: !!window.Lenis, motion: document.documentElement.classList.contains('js-motion'), lenisOn: document.documentElement.classList.contains('lenis') })));
const h = await page.evaluate(() => document.documentElement.scrollHeight);
for (let y = 0; y <= h; y += 300) { await page.evaluate(v => window.scrollTo(0, v), y); await new Promise(r => setTimeout(r, 120)); }
await new Promise(r => setTimeout(r, 2500));
const stuck = await page.evaluate(() => {
  const hidden = [...document.querySelectorAll('[data-reveal]')].filter(e => getComputedStyle(e).opacity < 0.5).map(e => e.outerHTML.slice(0, 140) + ' | in: ' + (e.closest('section')?.id || '?') + ' | hidden ancestor: ' + !!e.closest('[hidden]'));
  const words = [...document.querySelectorAll('.mega .w > span')].filter(s => s.getBoundingClientRect().top - s.parentElement.getBoundingClientRect().top > 4).length;
  return { hiddenBlocks: hidden.slice(0, 10), hiddenCount: hidden.length, wordsStillLow: words, words: document.querySelectorAll('.mega .w').length };
});
console.log('after scroll:', JSON.stringify(stuck));
// the wallet menu's Connect button must be visible once the menu opens
await page.evaluate(() => window.scrollTo(0, 0)); await new Promise(r => setTimeout(r, 400));
await page.click('[data-wallet] .tw-btn'); await new Promise(r => setTimeout(r, 500));
console.log('wallet menu:', await page.evaluate(() => { const b = document.querySelector('[data-wallet] [data-in]'); const r = b?.getBoundingClientRect(); return b ? { opacity: getComputedStyle(b).opacity, visible: r.width > 0 && r.height > 0, radius: getComputedStyle(document.querySelector('.tw-btn')).borderRadius } : 'no connect button'; }));
await page.keyboard.press('Escape'); await page.mouse.click(5, 400);
// a mid-animation frame for the eye
await page.evaluate(() => window.scrollTo(0, 0)); await new Promise(r => setTimeout(r, 600));
const rugs = await page.$eval('#rugs', e => e.getBoundingClientRect().top + window.scrollY);
await page.evaluate(v => window.scrollTo(0, v - 200), rugs); await new Promise(r => setTimeout(r, 450));
await page.screenshot({ path: 'stills/motion-mid.png' });
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
await browser.close();
