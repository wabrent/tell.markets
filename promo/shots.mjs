// Screenshots of site pages for a visual check.  node shots.mjs http://localhost:3100
import puppeteer from 'puppeteer';
const base = process.argv[2];
const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
const page = await browser.newPage();
for (const [name, path, w, h, sel] of [
  ...(process.argv[3] ? process.argv[3].split(',').map(s => s.split(':')).map(([n, p, w, h, sel]) => [n, p, +w, +h, sel]) : [
    ['accuracy', '/accuracy', 1440, 1700], ['token', '/token', 1440, 2200], ['home', '/', 1440, 900],
    ['accuracy-mobile', '/accuracy', 390, 1500], ['token-mobile', '/token', 390, 1800],
  ]),
]) {
  await page.setViewport({ width: w, height: h });
  await page.goto(base + path, { waitUntil: 'networkidle0' });
  if (sel) await page.$eval(sel, el => el.scrollIntoView());
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: `stills/site-${name}.png` });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log(name, 'horizontal overflow px:', overflow);
}
await browser.close();
