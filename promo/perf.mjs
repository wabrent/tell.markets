// Frame-time profile: scrolls a page (or idles on the map) and reports FPS, slow frames and long tasks.
//   node perf.mjs <url> [scroll|idle] [seconds]
import puppeteer from 'puppeteer';
const [url, mode = 'scroll', secs = '8'] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(url, { waitUntil: 'networkidle2', timeout: 180_000 });
if (mode === 'idle') await page.waitForFunction(() => typeof G !== 'undefined' && G && G.nodes.length, { timeout: 180_000 }).catch(() => {});
await new Promise(r => setTimeout(r, 2500));
await page.evaluate(() => {
  window.__frames = []; window.__long = [];
  new PerformanceObserver(l => l.getEntries().forEach(e => window.__long.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: false });
  let last = performance.now();
  const f = t => { window.__frames.push(t - last); last = t; requestAnimationFrame(f); };
  requestAnimationFrame(f);
});
const end = Date.now() + Number(secs) * 1000;
if (mode === 'scroll') {
  // wheel like a person: bursts down, a pause, some back up
  while (Date.now() < end) {
    for (let i = 0; i < 6; i++) { await page.mouse.wheel({ deltaY: 120 }); await new Promise(r => setTimeout(r, 60)); }
    await new Promise(r => setTimeout(r, 250));
  }
} else await new Promise(r => setTimeout(r, Number(secs) * 1000));
const s = await page.evaluate(() => {
  const f = window.__frames.slice(5); const sorted = [...f].sort((a, b) => a - b);
  const avg = f.reduce((a, b) => a + b, 0) / f.length;
  return { frames: f.length, fps: Math.round(1000 / avg), p95ms: Math.round(sorted[Math.floor(f.length * 0.95)]), worstMs: Math.round(sorted[f.length - 1]),
    over50ms: f.filter(x => x > 50).length, longTasks: window.__long.length, longestTask: Math.max(0, ...window.__long) };
});
console.log(url.replace(/^https?:\/\/[^/]+/, ''), mode, JSON.stringify(s), errors.length ? 'ERRORS: ' + errors.join(' | ') : '');
await browser.close();
