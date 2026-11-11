// Screenshots of site pages for a visual check.  node shots.mjs http://localhost:3100
import puppeteer from 'puppeteer';
const base = process.argv[2];
const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
const page = await browser.newPage();
for (const [name, path, w, h, sel] of [
  ['docs', '/docs', 1440, 1800], ['proof', '/proof', 1440, 1500], ['agents', '/', 1440, 1100, '#agents'], ['docs-mobile', '/docs', 390, 1600], ['proof-mobile', '/proof', 390, 1400],
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
