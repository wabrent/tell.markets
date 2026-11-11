// Renders the X avatar options (400x400) and banner (1500x500) to PNG, plus previews with X's crops.
import puppeteer from 'puppeteer';
import { readFileSync } from 'node:fs';

const b64 = p => readFileSync(new URL(p, import.meta.url)).toString('base64');
const font = (f, fam, style = 'normal') => `@font-face { font-family: '${fam}'; font-style: ${style}; src: url(data:font/ttf;base64,${b64(`../../assets/fonts/${f}`)}); }`;
const FONTS = font('InstrumentSerif-Regular.ttf', 'TellSerif') + font('InstrumentSerif-Italic.ttf', 'TellSerif', 'italic') + font('JetBrainsMono.ttf', 'TellMono') + font('Inter.ttf', 'Inter');
const face = `data:image/webp;base64,${b64('face-crimson.webp')}`;
const faceBone = `data:image/webp;base64,${b64('face-bone.webp')}`;
const head = `data:image/webp;base64,${b64('head-crimson.webp')}`;
const BASE = `<style>${FONTS} *{margin:0;padding:0;box-sizing:border-box} body{width:var(--w);height:var(--h);overflow:hidden;position:relative}
  .grain{position:absolute;inset:0;opacity:.18;mix-blend-mode:overlay;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")}</style>`;

const designs = {
  // A: the site's mark: the athlete with a redaction bar over the eyes, TELL on the bar
  'avatar-a': { w: 400, h: 400, html: `<body style="--w:400px;--h:400px;background:#9b0f17">
    <img src="${face}" style="position:absolute;left:-30px;top:-38px;width:460px;image-rendering:pixelated">
    <div style="position:absolute;left:0;right:0;top:204px;height:58px;background:#0d0405;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 24px rgba(0,0,0,.35)">
      <span style="font:500 30px TellMono;letter-spacing:.42em;color:#efe9df;margin-left:.42em">TELL</span></div>
    <div class="grain"></div></body>` },
  // B: just the face, nothing on it: calmer, reads at tiny sizes
  'avatar-b': { w: 400, h: 400, html: `<body style="--w:400px;--h:400px;background:#9b0f17">
    <img src="${face}" style="position:absolute;left:-40px;top:-20px;width:480px;image-rendering:pixelated">
    <div class="grain"></div></body>` },
  // C: monogram: a big italic T in crimson on bone, the lightest option
  'avatar-c': { w: 400, h: 400, html: `<body style="--w:400px;--h:400px;background:#efe9df;display:grid;place-items:center">
    <span style="font:italic 400 360px/1 TellSerif;color:#9b0f17;transform:translate(-8px,-14px);letter-spacing:-.04em">T</span>
    <div style="position:absolute;bottom:46px;left:0;right:0;text-align:center;font:500 20px TellMono;letter-spacing:.5em;color:#1d0f0e;margin-left:.5em">TELL</div>
    <div class="grain" style="opacity:.1"></div></body>` },
  'banner': { w: 1500, h: 500, html: `<body style="--w:1500px;--h:500px;background:radial-gradient(90% 140% at 78% 40%,#b0121c 0%,#9b0f17 45%,#6a080e 100%)">
    <img src="${head}" style="position:absolute;right:-10px;top:-40px;height:620px;image-rendering:pixelated;-webkit-mask-image:linear-gradient(90deg,transparent 0%,#000 26%)">
    <div style="position:absolute;left:96px;top:74px">
      <div style="font:500 15px TellMono;letter-spacing:.26em;color:rgba(255,255,255,.78)">LAUNCH CHECKS · ROBINHOOD CHAIN</div>
      <div style="font:400 128px/.86 TellSerif;letter-spacing:-.03em;color:#fff;margin-top:22px">Read the tell<br>before you <i style="color:#ffd6d2">buy.</i></div>
      <div style="display:flex;gap:14px;margin-top:30px;font:500 15px TellMono;letter-spacing:.16em;color:#fff">
        <span style="background:#efe9df;color:#1d0f0e;padding:9px 14px">TELL.MARKETS</span>
        <span style="border:1px solid rgba(255,255,255,.55);padding:8px 14px">FOR PEOPLE &amp; AGENTS</span>
        <span style="border:1px solid rgba(255,255,255,.55);padding:8px 14px">MCP · x402</span></div>
    </div>
    <div class="grain"></div></body>` },
};

const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
const page = await browser.newPage();
for (const [name, d] of Object.entries(designs)) {
  await page.setViewport({ width: d.w, height: d.h, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head>${BASE}</head>${d.html}</html>`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: new URL(`${name}.png`, import.meta.url).pathname.slice(1) });
}
// how X shows them: avatars as circles at small sizes; the banner with the avatar over its corner
const img = n => `data:image/png;base64,${b64(`${n}.png`)}`;
await page.setViewport({ width: 1500, height: 820 });
await page.setContent(`<!doctype html><html><body style="margin:0;background:#000;font:14px sans-serif;color:#aaa">
  <div style="position:relative;width:1500px;height:500px"><img src="${img('banner')}" style="display:block">
    <img src="${img('avatar-a')}" style="position:absolute;left:30px;top:410px;width:200px;height:200px;border-radius:50%;border:5px solid #000"></div>
  <div style="display:flex;gap:60px;align-items:center;padding:130px 0 0 280px">
    ${['avatar-a', 'avatar-b', 'avatar-c'].map(n => `<div style="text-align:center"><img src="${img(n)}" style="width:134px;height:134px;border-radius:50%"><br><img src="${img(n)}" style="width:40px;height:40px;border-radius:50%;margin-top:10px"><div>${n}</div></div>`).join('')}
  </div></body></html>`, { waitUntil: 'load' });
await page.screenshot({ path: new URL('preview.png', import.meta.url).pathname.slice(1) });
await browser.close();
console.log('done');
