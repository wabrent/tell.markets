// Wheel-zooms the map and samples the scale every frame: it should ease, not jump; a throw should glide.
import puppeteer from 'puppeteer';
const url = process.argv[2];
const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(url, { waitUntil: 'networkidle2', timeout: 180_000 });
await page.waitForFunction(() => typeof G !== 'undefined' && G && G.nodes.length > 0, { timeout: 180_000 });
await new Promise(r => setTimeout(r, 3500)); // let the entrance fit finish
const c = await page.$eval('canvas', el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 }; });
await page.mouse.move(c.x, c.y);
const before = await page.evaluate(() => transform.k);
await page.mouse.wheel({ deltaY: -300 });
const samples = await page.evaluate(() => new Promise(res => { const out = []; const f = () => { out.push(+transform.k.toFixed(3)); out.length < 30 ? requestAnimationFrame(f) : res(out); }; requestAnimationFrame(f); }));
console.log('k before', before.toFixed(3), '-> frames:', samples.join(' '));
const steps = samples.filter((v, i) => i && v !== samples[i - 1]).length;
console.log(steps >= 8 ? `PASS zoom eased over ${steps} frames` : `FAIL zoom changed in only ${steps} frames`);
// throw: drag fast and release, then watch x keep moving
await page.mouse.move(c.x - 200, c.y + 150);
await page.mouse.down();
for (let i = 1; i <= 6; i++) { await page.mouse.move(c.x - 200 + i * 40, c.y + 150, { steps: 1 }); await new Promise(r => setTimeout(r, 12)); }
await page.mouse.up();
const glideXs = await page.evaluate(() => new Promise(res => { const out = []; const f = () => { out.push(Math.round(transform.x)); out.length < 20 ? requestAnimationFrame(f) : res(out); }; requestAnimationFrame(f); }));
console.log('x after release:', glideXs.join(' '));
console.log(glideXs[glideXs.length - 1] > glideXs[0] + 5 ? 'PASS map glides after a throw' : 'FAIL no glide');
console.log(errors.length ? 'ERRORS: ' + errors.join(' | ') : 'no errors');
await browser.close();
