// Shared bits for every Tell page: wallet sign-in, watchlist, score sparkline.
(function () {
  const Tell = (window.Tell = {});
  const short = a => a.slice(0, 6) + '…' + a.slice(-4);

  /* ---------------- wallet ---------------- */
  // Renders a "Connect" pill into every [data-wallet] element. Signing in is a plain message
  // signature: no transaction, no gas.
  Tell.me = null;
  const css = `
  .tw { position: relative; }
  .tw-btn { display: inline-flex; align-items: center; gap: 8px; border: 1px solid rgba(255,255,255,.3); background: rgba(0,0,0,.18); backdrop-filter: blur(6px);
    color: inherit; border-radius: 9999px; padding: 8px 14px; font: 500 13px Inter, system-ui, sans-serif; cursor: pointer; transition: border-color .2s, background .2s; white-space: nowrap; }
  .tw-btn:hover { border-color: #fff; background: rgba(255,255,255,.06); }
  .tw-dot { width: 7px; height: 7px; border-radius: 50%; background: #9a958d; }
  .tw-dot.on { background: #4fb27a; box-shadow: 0 0 10px #4fb27a; }
  .tw-menu { position: absolute; right: 0; top: calc(100% + 8px); width: 260px; padding: 14px; border-radius: 14px; z-index: 50;
    background: rgba(24,8,10,.96); border: 1px solid rgba(255,255,255,.14); backdrop-filter: blur(12px); color: #ece9e2; font: 13px/1.5 Inter, system-ui, sans-serif;
    opacity: 0; transform: translateY(-6px); pointer-events: none; transition: opacity .2s, transform .25s cubic-bezier(.2,.7,.2,1); box-shadow: 0 20px 50px -20px #000; }
  .tw.open .tw-menu { opacity: 1; transform: none; pointer-events: auto; }
  .tw-menu b { font-family: 'Instrument Serif', serif; font-weight: 400; font-size: 24px; display: block; }
  .tw-menu small { color: #9a958d; display: block; margin-top: 4px; }
  .tw-menu button { margin-top: 12px; width: 100%; border: 1px solid rgba(255,255,255,.2); background: none; color: inherit; border-radius: 9999px; padding: 7px; cursor: pointer; font: inherit; }
  .tw-menu button:hover { border-color: #fff; }
  .tw-err { color: #ffb4b6; margin-top: 8px; font-size: 12px; }`;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  async function refreshMe() {
    try { Tell.me = await (await fetch('/api/me')).json(); } catch { Tell.me = null; }
    document.querySelectorAll('[data-wallet]').forEach(render);
    document.dispatchEvent(new CustomEvent('tell:me', { detail: Tell.me }));
  }

  function render(host) {
    const me = Tell.me || {};
    host.classList.add('tw');
    const status = !me.address ? '' : !me.tokenLive
      ? '<small>$TELL isn\'t live yet. Holder perks switch on at launch.</small>'
      : me.holder ? `<small>Holder: ${me.holds.toLocaleString('en-US')} $TELL · unlimited checks</small>`
        : `<small>Holds ${me.holds.toLocaleString('en-US')} $TELL. ${me.holderMin.toLocaleString('en-US')} unlocks unlimited checks.</small>`;
    host.innerHTML = me.address
      ? `<button class="tw-btn" type="button"><i class="tw-dot ${me.holder ? 'on' : ''}"></i>${short(me.address)}</button>
         <div class="tw-menu"><span style="font:10.5px 'JetBrains Mono',monospace;letter-spacing:.14em;color:#9a958d">SIGNED IN</span><b>${short(me.address)}</b>${status}<button type="button" data-out>Sign out</button></div>`
      : `<button class="tw-btn" type="button"><i class="tw-dot"></i>Connect wallet</button>
         <div class="tw-menu"><b>Sign in</b><small>Sign a message with your wallet. No transaction, no gas. $TELL holders get unlimited checks.</small><button type="button" data-in>Connect</button><div class="tw-err"></div></div>`;
    host.querySelector('.tw-btn').onclick = e => { e.stopPropagation(); host.classList.toggle('open'); };
    host.querySelector('[data-in]')?.addEventListener('click', () => signIn(host));
    host.querySelector('[data-out]')?.addEventListener('click', async () => { await fetch('/api/auth/logout', { method: 'POST' }); host.classList.remove('open'); refreshMe(); });
  }
  document.addEventListener('click', e => document.querySelectorAll('.tw.open').forEach(h => { if (!h.contains(e.target)) h.classList.remove('open'); }));

  async function signIn(host) {
    const err = host.querySelector('.tw-err');
    const eth = window.ethereum;
    if (!eth) { err.textContent = 'No wallet found. Install MetaMask or Rabby, then reload.'; return; }
    try {
      const [address] = await eth.request({ method: 'eth_requestAccounts' });
      const { nonce, message } = await (await fetch('/api/auth/nonce?address=' + address)).json();
      const signature = await eth.request({ method: 'personal_sign', params: [message, address] });
      const res = await fetch('/api/auth/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address, nonce, signature }) });
      if (!res.ok) throw new Error((await res.json()).error || 'Sign-in failed');
      host.classList.remove('open');
      refreshMe();
    } catch (e) {
      err.textContent = e?.code === 4001 ? 'Request was cancelled in the wallet.' : (e?.message || 'Sign-in failed');
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refreshMe); else refreshMe();

  /* ---------------- watchlist ---------------- */
  // Kept in this browser only. Each entry remembers the score when it was added.
  const KEY = 'tell.watch';
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
  const write = l => { try { localStorage.setItem(KEY, JSON.stringify(l)); } catch {} };
  Tell.watch = {
    list: read,
    has: a => read().some(w => w.address.toLowerCase() === a.toLowerCase()),
    toggle(r) {
      const l = read();
      const i = l.findIndex(w => w.address.toLowerCase() === r.token.address.toLowerCase());
      if (i >= 0) l.splice(i, 1);
      else l.unshift({ address: r.token.address, symbol: r.token.symbol, name: r.token.name, score: r.score.value, at: Date.now() });
      write(l.slice(0, 100));
      return i < 0;
    },
  };

  /* ---------------- token avatar ---------------- */
  // The token's own image when it has one; otherwise a monogram in the site's style, coloured from
  // the address so every token keeps the same look everywhere. The monogram sits underneath, so a
  // broken image simply reveals it.
  const HUES = [356, 8, 22, 36, 48, 150, 172, 196, 212, 228, 258, 285];
  const escA = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  Tell.avatar = function (address, symbol, image) {
    const a = String(address || '0x0').toLowerCase();
    let h = 0;
    for (let i = 2; i < a.length; i++) h = (h * 31 + a.charCodeAt(i)) >>> 0;
    const hue = HUES[h % HUES.length];
    const letter = (String(symbol || '').replace(/[^\p{L}\p{N}]/gu, '')[0] || '?').toUpperCase();
    return `<span class="tph" style="--h:${hue};--r:${(h >> 8) % 360}deg">${escA(letter)}</span>`
      + (image ? `<img class="timg" src="${escA(image)}" alt="" loading="lazy" onerror="this.remove()">` : '');
  };
  const s3 = document.createElement('style');
  s3.textContent = `
  .tph { position: absolute; inset: 0; display: grid; place-items: center; border-radius: inherit; color: #fff;
    font-family: 'Instrument Serif', serif; font-size: 0.55em; line-height: 1; text-shadow: 0 1px 8px rgba(0,0,0,.35);
    background:
      repeating-linear-gradient(var(--r), rgba(255,255,255,.07) 0 1px, transparent 1px 4px),
      radial-gradient(circle at 30% 25%, hsl(var(--h) 62% 58%), hsl(var(--h) 58% 30%) 60%, hsl(var(--h) 60% 16%));
    box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); }
  .timg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; border-radius: inherit; display: block; }`;
  document.head.appendChild(s3);

  /* ---------------- sparkline ---------------- */
  // Risk over time as a small SVG line; red when it rose, green when it fell.
  Tell.sparkline = function (points, w = 120, h = 28) {
    if (!points || points.length < 2) return '';
    const xs = points.map(p => p.t), ys = points.map(p => p.s);
    const x0 = Math.min(...xs), x1 = Math.max(...xs) || 1;
    const sx = t => ((t - x0) / (x1 - x0 || 1)) * (w - 4) + 2;
    const sy = s => h - 2 - (s / 100) * (h - 4);
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.t).toFixed(1)},${sy(p.s).toFixed(1)}`).join('');
    const delta = ys[ys.length - 1] - ys[0];
    const c = delta > 0 ? '#ff5a5f' : delta < 0 ? '#4fb27a' : '#9a958d';
    const last = points[points.length - 1];
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-label="Risk score over time">
      <path d="${d}" fill="none" stroke="${c}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" pathLength="1" style="stroke-dasharray:1;stroke-dashoffset:1;animation:spark-draw 1.2s cubic-bezier(.2,.7,.2,1) forwards"/>
      <circle cx="${sx(last.t)}" cy="${sy(last.s)}" r="2.5" fill="${c}"/></svg>`;
  };
  const s2 = document.createElement('style');
  s2.textContent = '@keyframes spark-draw{to{stroke-dashoffset:0}}';
  document.head.appendChild(s2);
})();
