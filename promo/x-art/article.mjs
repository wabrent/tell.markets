// Images for the first X article: designed cards rendered from HTML, plus live screenshots of the site.
//   node article.mjs  ->  ../../brand/x/article-1/*.png
import puppeteer from 'puppeteer';
import { mkdirSync, readFileSync } from 'node:fs';

const OUT = new URL('../../brand/x/article-1/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const out = n => new URL(n, OUT).pathname.slice(1);
const b64 = p => readFileSync(new URL(p, import.meta.url)).toString('base64');
const font = (f, fam, style = 'normal') => `@font-face { font-family: '${fam}'; font-style: ${style}; src: url(data:font/ttf;base64,${b64(`../../assets/fonts/${f}`)}); }`;
const FONTS = font('InstrumentSerif-Regular.ttf', 'TellSerif') + font('InstrumentSerif-Italic.ttf', 'TellSerif', 'italic') + font('JetBrainsMono.ttf', 'TellMono') + font('Inter.ttf', 'TellSans');
const img = p => `data:image/webp;base64,${b64(p)}`;
const death = img('../../web/assets/art-death.webp'), medusa = img('../../web/assets/art-medusa.webp');
const GRAIN = `<div style="position:absolute;inset:0;opacity:.16;mix-blend-mode:overlay;background-image:url(&quot;data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>&quot;)"></div>`;
const page0 = (w, h, bg, body) => `<!doctype html><html><head><style>${FONTS}*{margin:0;padding:0;box-sizing:border-box}
  body{width:${w}px;height:${h}px;overflow:hidden;position:relative;background:${bg};font-family:TellSans}
  .label{font:500 17px TellMono;letter-spacing:.24em;text-transform:uppercase}
  .mega{font:400 120px/.86 TellSerif;letter-spacing:-.03em} i{font-style:italic}</style></head><body>${body}${GRAIN}</body></html>`;

const cards = {
  '0-cover.png': [1500, 600, '#1c0205', `
    <img src="${death}" style="position:absolute;right:-40px;top:-60px;width:1000px;opacity:.85;image-rendering:pixelated;-webkit-mask-image:linear-gradient(90deg,transparent,#000 35%)">
    <div style="position:absolute;inset:0;background:linear-gradient(90deg,#1c0205 0%,rgba(28,2,5,.9) 36%,rgba(28,2,5,.2) 75%)"></div>
    <div style="position:absolute;left:90px;top:120px;color:#efe9df">
      <div class="label" style="color:rgba(239,233,223,.7)">Tell · Robinhood Chain</div>
      <div class="mega" style="font-size:140px;margin-top:26px">Every token<br><i style="color:#e0898c">has a tell.</i></div>
      <div class="label" style="margin-top:34px;color:rgba(239,233,223,.75)">tell.markets</div></div>`],

  '1-numbers.png': [1600, 900, 'radial-gradient(90% 120% at 80% 30%,#b0121c,#9b0f17 50%,#6a080e)', `
    <img src="${img('head-crimson.webp')}" style="position:absolute;right:-30px;top:-70px;height:640px;opacity:.9;image-rendering:pixelated;-webkit-mask-image:linear-gradient(90deg,transparent 0%,#000 30%),linear-gradient(0deg,transparent 0%,#000 25%);-webkit-mask-composite:source-in">
    <div style="position:absolute;left:110px;top:100px;color:#fff">
      <div class="label" style="color:rgba(255,255,255,.75)">Pons · the last 24 hours</div>
      <div class="mega" style="margin-top:22px;font-size:104px">Most launches die.<br><i style="color:#ffd6d2">Some are killed.</i></div></div>
    <div style="position:absolute;left:110px;right:110px;bottom:110px;display:grid;grid-template-columns:repeat(3,1fr);gap:40px;color:#fff">
      ${[['771', 'tokens launched'], ['392', 'checked by Tell'], ['&lt;1%', 'still trading days later']].map(([n, l]) => `
        <div style="border-top:1px solid rgba(255,255,255,.35);padding-top:22px"><div style="font:400 150px/.84 TellSerif;letter-spacing:-.04em">${n}</div>
        <div class="label" style="margin-top:16px;color:rgba(255,255,255,.78)">${l}</div></div>`).join('')}</div>
    <div style="position:absolute;right:110px;bottom:46px;font:500 13px TellMono;letter-spacing:.14em;color:rgba(255,255,255,.55)">"STILL TRADING" = A POOL WITH $5K+ LIQUIDITY, 2–7 DAYS AFTER THE FIRST CHECK · 3,565 LAUNCHES</div>`],

  '2-checks.png': [1600, 900, '#efe9df', `
    <div style="position:absolute;left:110px;top:90px;color:#1d0f0e">
      <div class="label" style="color:#9b0f17">Six checks · one score</div>
      <div class="mega" style="margin-top:20px;font-size:96px">Fifteen minutes of homework.<br><i style="color:#9b0f17">A few seconds.</i></div></div>
    <div style="position:absolute;left:110px;right:110px;top:400px;display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid rgba(29,15,14,.2)">
      ${[['01', 'Contract', 'Mint, pause, blacklist, taxes, proxy, owner'], ['02', 'Holders', 'Top wallets, linked clusters, snipers'], ['03', 'Deployer', 'What they hold, what they sold, past launches'],
         ['04', 'Website', 'Real product or a waitlist, red flags'], ['05', 'Promises', 'What the site claims vs what the chain shows'], ['06', 'Market', 'Liquidity, pool age, sell pressure']].map(([n, t, d]) => `
        <div style="padding:26px 30px 26px 0;border-bottom:1px solid rgba(29,15,14,.2)">
          <div style="font:400 64px/.8 TellSerif;color:#9b0f17">${n}</div>
          <div style="font:400 38px TellSerif;color:#1d0f0e;margin-top:12px">${t}</div>
          <div style="font:400 19px TellSans;color:#5a4744;margin-top:6px">${d}</div></div>`).join('')}</div>`],

  '5-agents.png': [1600, 900, '#0b0b0c', `
    <img src="${medusa}" style="position:absolute;right:-80px;top:0;height:900px;opacity:.5;image-rendering:pixelated;-webkit-mask-image:linear-gradient(90deg,transparent,#000 40%)">
    <div style="position:absolute;inset:0;background:linear-gradient(90deg,#0b0b0c 40%,rgba(11,11,12,.6) 70%,rgba(11,11,12,.2))"></div>
    <div style="position:absolute;left:110px;top:90px;color:#efe9df">
      <div class="label" style="color:#9a958d">For agents · MCP · HTTP · x402</div>
      <div class="mega" style="margin-top:20px;font-size:100px">Your bot buys fast.<br><i>Let it read first.</i></div></div>
    <div style="position:absolute;left:110px;top:420px;display:flex;gap:28px">
      <pre style="font:400 22px/1.6 TellMono;color:#efe9df;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.12);padding:28px 32px;width:560px">{
  <span style="color:#e8b3b5">"mcpServers"</span>: {
    <span style="color:#e8b3b5">"tell"</span>: {
      <span style="color:#e8b3b5">"type"</span>: <span style="color:#b9d3a8">"http"</span>,
      <span style="color:#e8b3b5">"url"</span>: <span style="color:#b9d3a8">"https://tell.markets/mcp"</span>
    }
  }
}</pre>
      <pre style="font:400 22px/1.6 TellMono;color:#efe9df;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.12);padding:28px 32px;width:500px"><span style="color:#9a958d">check_token("0x45C8…0962")</span>
→ <span style="color:#e3a540">risk 40/100 · medium</span>
  <span style="color:#ff8a8f">● deployer sold whole bag</span>
  <span style="color:#ff8a8f">● no website listed</span>
  <span style="color:#7fd3a0">● no owner, no mint</span>
  <span style="color:#7fd3a0">● snipers sold out</span></pre></div>`],
};

const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
const page = await browser.newPage();
for (const [name, [w, h, bg, body]] of Object.entries(cards)) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.setContent(page0(w, h, bg, body), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out(name) });
  console.log('card', name);
}

// live screenshots: a real report, and the token map of the same token
const TOKEN = '0x45C83b37C5BAF4dad26f3845C28295e2DE010962';
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
await page.goto(`https://tell.markets/t/${TOKEN}`, { waitUntil: 'networkidle2', timeout: 120_000 });
await page.waitForFunction(() => /HOOD/.test(document.querySelector('#report-body')?.innerText || '') && !document.querySelector('#report-body.loading'), { timeout: 120_000 });
await page.evaluate(() => { document.querySelectorAll('.js-motion-pre').forEach(e => e.classList.remove('js-motion-pre')); document.querySelectorAll('[data-reveal]').forEach(e => { e.style.opacity = 1; e.style.transform = 'none'; }); });
await new Promise(r => setTimeout(r, 1500));
const frame = await page.$('#report .frame');
await frame.evaluate(el => el.scrollIntoView({ block: 'center' }));
await new Promise(r => setTimeout(r, 800));
await frame.screenshot({ path: out('3-report.png') });
console.log('shot 3-report.png');

await page.setViewport({ width: 1600, height: 960, deviceScaleFactor: 1 });
await page.goto(`https://tell.markets/app/${TOKEN}`, { waitUntil: 'networkidle2', timeout: 120_000 });
await page.waitForFunction(() => typeof G !== 'undefined' && G && G.nodes.length, { timeout: 120_000 });
await new Promise(r => setTimeout(r, 5000));
const stage = await page.$('.stage');
await stage.screenshot({ path: out('4-map.png') });
console.log('shot 4-map.png');
await browser.close();
