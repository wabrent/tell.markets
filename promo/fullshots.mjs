// Full-page screenshots, cut into viewport-height tiles for review.  node fullshots.mjs name=url ...
import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
for (const arg of process.argv.slice(2)) {
  const [name, url] = arg.split('=');
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 });
  // let scroll-triggered reveals fire
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 600) { await page.evaluate(v => window.scrollTo(0, v), y); await new Promise(r => setTimeout(r, 150)); }
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise(r => setTimeout(r, 800));
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  const tiles = Math.min(8, Math.ceil(total / 1800));
  for (let i = 0; i < tiles; i++) {
    await page.screenshot({ path: `stills/cmp-${name}-${i}.png`, clip: { x: 0, y: i * 1800, width: 1440, height: Math.min(1800, total - i * 1800) }, captureBeyondViewport: true });
  }
  console.log(name, 'height', total, 'tiles', tiles);
}
await browser.close();
