// Screenshots the token map after it loads.  node mapshot.mjs <url> <out-prefix>
import puppeteer from 'puppeteer';
const [url, out] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--enable-gpu-rasterization'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url, { waitUntil: 'networkidle2', timeout: 180_000 });
// wait until the side panel shows a score, i.e. the report (and map) arrived
await page.waitForFunction(() => /\/\s*100/.test(document.body.innerText) && document.querySelector('#map-title')?.textContent?.length > 1, { timeout: 180_000 }).catch(() => errors.push('map did not load in time'));
await new Promise(r => setTimeout(r, 900));
await page.screenshot({ path: `stills/${out}-a.png` });   // mid-entrance
await new Promise(r => setTimeout(r, 4500));
await page.screenshot({ path: `stills/${out}-b.png` });   // settled
// hover the biggest node to see focus styling
const box = await page.$eval('canvas', c => { const r = c.getBoundingClientRect(); return { x: r.x + r.width * 0.55, y: r.y + r.height * 0.45 }; });
await page.mouse.move(box.x, box.y);
await new Promise(r => setTimeout(r, 600));
await page.screenshot({ path: `stills/${out}-c.png` });
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
