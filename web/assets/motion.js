// Shared motion for Tell's inner pages: smooth scroll, headings that rise word by word, blocks that
// ease in, numbers that count up, art that drifts. Pure decoration: without it (old browser, blocked
// CDN, "reduce motion") every page reads exactly the same.
(function () {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const LIBS = [
    'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js',
    'https://cdn.jsdelivr.net/npm/@studio-freight/lenis@1.0.42/dist/lenis.min.js',
  ];
  const load = src => new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = fail; document.head.appendChild(s); });

  const css = document.createElement('style');
  css.textContent = `
    .mw { display: inline-block; overflow: hidden; vertical-align: top; padding: 0 .08em .14em 0; margin: 0 -.08em -.14em 0; }
    .mw > span { display: inline-block; will-change: transform; }
    .m-on .m-split .mw > span { transform: translateY(110%); }
    .m-on [data-reveal] { opacity: 0; transform: translateY(26px); }
    html.lenis, html.lenis body { height: auto; }
    .lenis.lenis-smooth { scroll-behavior: auto !important; }
    a, button, .chip, .tag, input, select { transition: color .25s, background-color .25s, border-color .25s, transform .3s cubic-bezier(.2,.7,.2,1), box-shadow .25s; }`;
  document.head.appendChild(css);

  // hide what will animate before the first paint, so nothing flashes in and then jumps
  const HEADINGS = '.band h1, main h2, main h1';
  const REVEAL = [
    '.band .label', '.band p', '.band .ca', '.band .stats > div', '.band .counters > div', '.band form',
    'main .tbl', 'main .box', 'main .cards > div', 'main .steps > div', 'main .grid3 > div', 'main .chart',
    'main details', 'main pre', 'main .sub', 'main .note', 'main .lookup', 'main .rule', 'main .collecting', 'main section > .label',
  ].join(',');
  const prep = () => {
    document.documentElement.classList.add('m-on');
    document.querySelectorAll(HEADINGS).forEach(split);
    document.querySelectorAll(REVEAL).forEach(el => el.setAttribute('data-reveal', ''));
  };

  function split(el) {
    if (el.classList.contains('m-split')) return;
    el.classList.add('m-split');
    const walk = node => [...node.childNodes].forEach(n => {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach(part => {
          if (!part) return;
          if (/^\s+$/.test(part)) return frag.appendChild(document.createTextNode(part));
          const w = document.createElement('span'); w.className = 'mw';
          const i = document.createElement('span'); i.textContent = part;
          w.appendChild(i); frag.appendChild(w);
        });
        n.replaceWith(frag);
      } else if (n.nodeType === 1 && n.tagName !== 'BR' && !n.querySelector('input,button')) walk(n);
    });
    walk(el);
  }

  // run once the page's own markup exists
  const ready = fn => (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn) : fn());
  ready(() => {
    prep();
    // if the libraries can't load, show everything rather than leave it hidden
    const bail = setTimeout(() => document.documentElement.classList.remove('m-on'), 2500);
    Promise.all(LIBS.slice(0, 1).map(load)).then(() => Promise.all(LIBS.slice(1).map(load))).then(() => { clearTimeout(bail); start(); })
      .catch(() => { clearTimeout(bail); document.documentElement.classList.remove('m-on'); });
  });

  function start() {
    const { gsap, ScrollTrigger, Lenis } = window;
    gsap.registerPlugin(ScrollTrigger);

    if (Lenis) {
      const lenis = new Lenis({ duration: 1.15, easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)) });
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add(t => lenis.raf(t * 1000));
      gsap.ticker.lagSmoothing(0);
      window.TellLenis = lenis;
      document.querySelectorAll('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
        const id = a.getAttribute('href'); const el = id.length > 1 && document.querySelector(id);
        if (el) { e.preventDefault(); lenis.scrollTo(el, { offset: -24 }); history.replaceState(null, '', id); }
      }));
    }

    // headings: the page title rises right away, the rest as they scroll in
    document.querySelectorAll('.m-split').forEach(h => {
      const words = h.querySelectorAll('.mw > span');
      const inBand = h.closest('.band');
      gsap.to(words, { y: 0, duration: 1.1, ease: 'expo.out', stagger: 0.05, delay: inBand ? 0.1 : 0,
        scrollTrigger: inBand ? undefined : { trigger: h, start: 'top 85%' } });
    });

    ScrollTrigger.batch('[data-reveal]', {
      start: 'top 90%',
      onEnter: els => gsap.to(els, { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out', stagger: 0.07, overwrite: true }),
    });

    // header art drifts as the page moves
    document.querySelectorAll('.band .ghost').forEach(img => gsap.to(img, { yPercent: 12, ease: 'none', scrollTrigger: { trigger: img.closest('.band'), start: 'top top', end: 'bottom top', scrub: true } }));

    // numbers in the header count up when their value arrives (most come from a fetch)
    document.querySelectorAll('.band .stats b, .band .counters b').forEach(watchCount);

    // Tables and charts filled in later by the page ease in, once. A container that refills itself
    // (the launch feed re-renders every 20s and animates its own new rows) is left alone after
    // its first fill, so nothing flickers on refresh.
    const filled = new WeakSet();
    const mo = new MutationObserver(list => {
      for (const m of list) {
        const box = m.target;
        if (filled.has(box) || box.closest('#list, .feed, #feed')) continue;
        const rows = [...m.addedNodes].filter(n => n.nodeType === 1 && n.isConnected && n.matches('tr, .bar-row, .cp'));
        if (!rows.length) continue;
        filled.add(box);
        gsap.from(rows, { opacity: 0, y: 10, duration: 0.6, ease: 'power2.out', stagger: 0.03, clearProps: 'opacity,transform' });
      }
    });
    document.querySelectorAll('main').forEach(el => mo.observe(el, { childList: true, subtree: true }));

    // buttons lean toward the pointer a little
    document.querySelectorAll('.btn, .sq, .lookup button, .ca button, .ca a').forEach(b => {
      b.addEventListener('pointermove', e => { const r = b.getBoundingClientRect(); gsap.to(b, { x: (e.clientX - r.left - r.width / 2) * 0.12, y: (e.clientY - r.top - r.height / 2) * 0.2, duration: .4, ease: 'power3.out' }); });
      b.addEventListener('pointerleave', () => gsap.to(b, { x: 0, y: 0, duration: .6, ease: 'elastic.out(1, .5)' }));
    });

    addEventListener('load', () => ScrollTrigger.refresh());
    setTimeout(() => ScrollTrigger.refresh(), 1500); // pages that fill in from an API grow after load
  }

  function watchCount(el) {
    let last = '';
    const run = () => {
      const txt = el.textContent.trim();
      if (txt === last || el.dataset.counting) return;
      const m = txt.match(/^([^\d-]*)([\d,]*\.?\d+)(.*)$/);
      if (!m) { last = txt; return; }
      const to = parseFloat(m[2].replace(/,/g, '')); const dec = (m[2].split('.')[1] || '').length;
      last = txt; el.dataset.counting = '1';
      const o = { v: 0 };
      window.gsap.to(o, { v: to, duration: 1.4, ease: 'power3.out',
        onUpdate: () => { el.textContent = m[1] + o.v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + m[3]; },
        onComplete: () => { el.textContent = txt; last = txt; delete el.dataset.counting; } });
    };
    run();
    new MutationObserver(run).observe(el, { childList: true, characterData: true, subtree: true });
  }
})();
