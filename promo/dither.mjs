// Turns public-domain art into Tell's two-tone dithered look, in Chrome's canvas.
//   node dither.mjs sheet                      -> stills/art-sheet.png (all sources, small)
//   node dither.mjs <name> <out> <w> <fg> <bg> [crop x,y,w,h as 0..1] [contrast]
import puppeteer from 'puppeteer';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
const page = await browser.newPage();
const dataUrl = f => 'data:image/jpeg;base64,' + readFileSync(`art-src/${f}`).toString('base64');

if (process.argv[2] === 'sheet') {
  const files = readdirSync('art-src').filter(f => f.endsWith('.jpg'));
  await page.setViewport({ width: 1500, height: 1100 });
  await page.setContent(`<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font:14px sans-serif;color:#fff">${
    files.map(f => `<div><img src="${dataUrl(f)}" style="width:100%;height:500px;object-fit:contain;background:#222"><div>${f}</div></div>`).join('')}</body>`);
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: 'stills/art-sheet.png', fullPage: true });
} else {
  const [name, out, w, fg, bg, crop = '0,0,1,1', contrast = '1.25', bias = '0'] = process.argv.slice(2);
  const webp = await page.evaluate(async (src, W, fg, bg, crop, contrast, bias) => {
    const img = new Image(); img.src = src; await img.decode();
    const [cx, cy, cw, ch] = crop.split(',').map(Number);
    const sw = img.width * cw, sh = img.height * ch;
    const H = Math.round(W * sh / sw);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.drawImage(img, img.width * cx, img.height * cy, sw, sh, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H); const px = d.data;
    // luminance with contrast around the mean, then Floyd–Steinberg to two inks
    const lum = new Float32Array(W * H); let mean = 0;
    for (let i = 0; i < W * H; i++) { lum[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255; mean += lum[i]; }
    mean /= W * H;
    for (let i = 0; i < W * H; i++) lum[i] = Math.min(1, Math.max(0, (lum[i] - mean) * contrast + 0.5 + bias));
    const hex = h => [1, 3, 5].map(j => parseInt(h.slice(j, j + 2), 16));
    const F = hex(fg), B = hex(bg);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, o = lum[i], n = o > 0.5 ? 1 : 0, e = o - n;
      lum[i] = n;
      if (x + 1 < W) lum[i + 1] += e * 7 / 16;
      if (y + 1 < H) { if (x > 0) lum[i + W - 1] += e * 3 / 16; lum[i + W] += e * 5 / 16; if (x + 1 < W) lum[i + W + 1] += e / 16; }
      const col = n ? F : B;
      px[i * 4] = col[0]; px[i * 4 + 1] = col[1]; px[i * 4 + 2] = col[2]; px[i * 4 + 3] = 255;
    }
    g.putImageData(d, 0, 0);
    return c.toDataURL('image/webp', 0.86);
  }, dataUrl(`${name}.jpg`), Number(w), fg, bg, crop, Number(contrast), Number(bias));
  writeFileSync(out, Buffer.from(webp.split(',')[1], 'base64'));
  console.log('wrote', out);
}
await browser.close();
