// Looks for the glitches fixed today:
//  1. homepage: no heading/block that is visible at first paint and then hidden (flash)
//  2. launches: rows don't fade out and back in when the feed refreshes
//  3. check button: page scroll ends at the report, without a tug-of-war
import puppeteer from 'puppeteer';
const base = process.argv[2];
const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
const errors = [];

// 1. sample the first headline's opacity/transform from the very first frames
{
  const page = await browser.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument(() => {
    window.__vis = [];
    const sample = () => {
      const h = document.querySelector('#checks .mega');
      if (h) { const r = h.getBoundingClientRect(); const cs = getComputedStyle(h); const w = h.querySelector('.w > span');
        window.__vis.push(`${Math.round(performance.now())}:${cs.opacity}${w ? ':w' + Math.round(w.getBoundingClientRect().top - r.top) : ''}`); }
      if (performance.now() < 4000) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.goto(base + '/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 3000));
  const vis = await page.evaluate(() => window.__vis);
  // a flash = opacity 1 with words at rest (unsplit, visible) before the words are moved away
  const firstShown = vis.findIndex(v => v.split(':')[1] === '1' && !v.includes(':w'));
  console.log('homepage first frames:', vis.slice(0, 4).join(' '), '…', vis.length, 'samples');
  console.log(firstShown === -1 ? 'PASS no headline flash before motion' : `FAIL headline painted visible at sample ${firstShown} (${vis[firstShown]})`);

  // 3. click check, watch scroll position settle at the report
  await page.type('#addr', '0x45C83b37C5BAF4dad26f3845C28295e2DE010962');
  await page.click('#form button[type=submit]');
  const ys = await page.evaluate(() => new Promise(res => { const out = []; const f = () => { out.push(Math.round(scrollY)); out.length < 90 ? requestAnimationFrame(f) : res(out); }; requestAnimationFrame(f); }));
  const back = ys.slice(1).filter((y, i) => y < ys[i] - 2).length;
  const target = await page.$eval('#report', el => Math.round(el.getBoundingClientRect().top + scrollY));
  console.log('scroll to report:', ys.filter((_, i) => i % 10 === 0).join(' '), '| report at', target);
  console.log(back === 0 && Math.abs(ys[ys.length - 1] - (target - 10)) < 40 ? 'PASS smooth scroll to report, no tug-of-war' : `FAIL scroll moved backwards ${back} times / ended at ${ys[ys.length - 1]}`);
  await page.close();
}

// 2. launches: force two refreshes and watch a row's opacity
{
  const page = await browser.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(base + '/launches', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelectorAll('#list .row').length >= 3, { timeout: 30_000 }).catch(() => errors.push('no launch rows to test'));
  await new Promise(r => setTimeout(r, 2500));
  const dips = await page.evaluate(() => new Promise(res => {
    let min = 1; const end = performance.now() + 2500;
    const f = () => { const row = document.querySelector('#list .row:nth-child(3)'); if (row) min = Math.min(min, +getComputedStyle(row).opacity); performance.now() < end ? requestAnimationFrame(f) : res(min); };
    // re-render the list exactly the way the page's 20s/60s timers do
    draw(false); requestAnimationFrame(f);
  }));
  console.log(dips > 0.9 ? 'PASS launch rows stay put on refresh' : `FAIL rows faded to ${dips} on refresh`);
  await page.close();
}
console.log(errors.length ? 'ERRORS: ' + errors.join(' | ') : 'no page errors');
await browser.close();
