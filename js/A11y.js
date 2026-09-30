/*!
 * a11y-autoload.js  v1.2.0
 * Drop-in accessibility layer that loads on every page, remembers each visitor's
 * settings across pages and tabs, and supports per-page overrides.
 *
 * NOTE: This script was made with AI. The settings panel shows visitors a warning
 * saying so (wording can be changed with `aiNotice`, below).
 *
 * ── Install ────────────────────────────────────────────────────────────────
 * Put ONE tag in <head> of every page (or your shared layout). Do not add
 * async/defer, so saved settings apply before first paint (no flash):
 *
 *   <script>
 *     window.A11Y_CONFIG = {           // optional
 *       position: 'bottom-right',      // bottom-right | bottom-left | top-right | top-left
 *       hotkey: 'Alt+Shift+A',         // single letter/digit + modifiers, or '' to disable
 *       scaleMethod: 'font',           // 'font' (rem-based sites) | 'zoom' (px-based sites)
 *       defaults: { focusRing: true }, // site-wide starting values
 *       fontBase: 'https://cdn.jsdelivr.net/npm/@fontsource/opendyslexic@5.3.0/files/',
 *                                      // where OpenDyslexic loads from (see "Fonts" below)
 *       aiNotice: 'This accessibility tool was made with AI. ...', // warning text in the panel
 *       popup: 'session',              // tip bubble by the button: 'session' (once per visit) |
 *                                      //   'once' (once ever) | 'always' | false
 *       popupSeconds: 10,              // how long the tip stays up
 *       popupText: 'Change text size, contrast, fonts and more.',
 *       fontCache: true,               // keep OpenDyslexic in localStorage (see "Fonts")
 *       pageRules: [
 *         // Page A: start larger and calmer. The visitor can still change it.
 *         { match: '/docs/**', settings: { textScale: 1.2, font: 'sans' } },
 *         // Page B: enforce something. `force` locks the control in the panel.
 *         { match: '/checkout', settings: { reduceMotion: true }, force: true },
 *         // match can also be a RegExp or function(location) => boolean
 *       ]
 *     };
 *   </script>
 *   <script src="/a11y-autoload.js"></script>
 *
 * ── Fonts ──────────────────────────────────────────────────────────────────
 * The "OpenDyslexic" font option loads OpenDyslexic (SIL Open Font License 1.1)
 * from the jsDelivr CDN by default. Nothing is downloaded until a visitor actually
 * turns the font on. The first time the font is found, the regular and bold files are
 * also saved in the visitor's localStorage (about 300 KB), so every later page loads
 * it with no network request. Turn that off with fontCache: false. Italic files are
 * only fetched by the browser if a page uses italic text.
 *   • If your site has a Content-Security-Policy, allow the font host:
 *       font-src    https://cdn.jsdelivr.net   (showing the font)
 *       connect-src https://cdn.jsdelivr.net   (saving it to localStorage; without this
 *                                               the font still works, it just isn't saved)
 *   • To self-host instead, copy the opendyslexic-latin-{400,700}-{normal,italic}
 *     .woff2/.woff files from the @fontsource/opendyslexic npm package to a folder
 *     on your site and set  fontBase: '/fonts/'
 *   • To load nothing (use only a copy installed on the visitor's device): fontBase: null
 *
 * ── Precedence (lowest → highest) ──────────────────────────────────────────
 *   built-in defaults → OS preferences → config.defaults → non-forced pageRules
 *   → visitor's "All pages" settings → visitor's "This page only" settings
 *   → forced pageRules
 *
 * ── API ────────────────────────────────────────────────────────────────────
 *   A11y.get()                      effective settings for this page
 *   A11y.set({textScale: 1.3}, {scope: 'global' | 'page'})
 *   A11y.reset({scope: 'global' | 'page' | 'all'})
 *   A11y.open() / close() / toggle()
 *   A11y.onChange(fn) → unsubscribe  (also: document 'a11y:change' event)
 *
 * Settings are stored in localStorage, so they are shared by every page on the
 * same origin (protocol + host + port) and sync live between open tabs.
 */
(() => {
  'use strict';

  const win = window;
  const doc = document;
  const root = doc.documentElement;
  if (win.A11y && win.A11y.__loaded) return;

  /* ───────────────────────── Configuration ───────────────────────── */

  const TITLE = 'A11y Accessibility';
  const DEFAULT_POPUP_TEXT = 'Change text size, contrast, fonts and more.';
  const DEFAULT_AI_NOTICE =
    'This accessibility tool was made with AI. It may contain mistakes and might not work correctly on every page or device.';

  const script = doc.currentScript;
  const ds = (script && script.dataset) || {};
  const cfg = Object.assign(
    {
      storageKey: 'a11y:v1',
      position: 'bottom-right',
      hotkey: 'Alt+Shift+A',
      scaleMethod: 'font',
      pageKey: null,
      defaults: {},
      pageRules: [],
      ui: true,
      // Where the OpenDyslexic font files are loaded from. Must end in "/" (added if missing).
      fontBase: 'https://cdn.jsdelivr.net/npm/@fontsource/opendyslexic@5.3.0/files/',
      // Warning shown at the top of the settings panel.
      aiNotice: DEFAULT_AI_NOTICE,
      // Small tip beside the button: 'session' (once per visit), 'once' (once ever), 'always', or false.
      popup: 'session',
      popupSeconds: 10,
      popupText: DEFAULT_POPUP_TEXT,
      // Keep the OpenDyslexic files in localStorage so later pages don't download them again.
      fontCache: true,
      // Elements the text/font/contrast overrides leave alone (icon fonts, code, SVG).
      excludeSelector:
        'svg, svg *, script, style, code, pre, kbd, samp, [class*="icon" i], [class*="fa-"], .material-icons, .material-symbols-outlined',
    },
    win.A11Y_CONFIG || {}
  );
  if (ds.storageKey) cfg.storageKey = ds.storageKey;
  if (ds.position) cfg.position = ds.position;
  if (ds.scaleMethod) cfg.scaleMethod = ds.scaleMethod;
  if (ds.fontBase) cfg.fontBase = ds.fontBase;
  if (ds.ui === 'false') cfg.ui = false;

  /* ───────────────────────── Settings schema ───────────────────────── */

  const BASE = {
    textScale: 1,
    lineHeight: 0,
    letterSpacing: 0,
    wordSpacing: 0,
    font: 'off',
    alignLeft: false,
    contrast: 'off',
    saturation: 'normal',
    highlightLinks: false,
    highlightHeadings: false,
    focusRing: false,
    readingGuide: false,
    bigCursor: false,
    reduceMotion: false,
  };
  const RANGE = {
    textScale: [1, 2],
    lineHeight: [0, 2.6],
    letterSpacing: [0, 0.3],
    wordSpacing: [0, 0.6],
  };
  const ENUM = {
    font: ['off', 'dyslexia', 'sans'],
    contrast: ['off', 'dark', 'light', 'yellow'],
    saturation: ['normal', 'grayscale', 'low'],
  };

  // Respect OS-level preferences until the visitor chooses otherwise.
  const SYS = {};
  try {
    if (win.matchMedia('(prefers-reduced-motion: reduce)').matches) SYS.reduceMotion = true;
    if (win.matchMedia('(prefers-contrast: more)').matches) SYS.focusRing = true;
  } catch (e) {}

  const clean = (o) => {
    const out = {};
    if (!o || typeof o !== 'object') return out;
    for (const k of Object.keys(BASE)) {
      if (!(k in o)) continue;
      const v = o[k];
      const d = BASE[k];
      if (typeof d === 'boolean') {
        out[k] = v === true || v === 'true' || v === 1;
      } else if (typeof d === 'number') {
        const n = Number(v);
        if (Number.isFinite(n)) {
          out[k] = Math.round(Math.min(RANGE[k][1], Math.max(RANGE[k][0], n)) * 100) / 100;
        }
      } else if (ENUM[k].includes(v)) {
        out[k] = v;
      }
    }
    return out;
  };

  /* ───────────────────────── Storage ───────────────────────── */

  let memStore = { v: 1, global: {}, pages: {} };

  const load = () => {
    try {
      const raw = win.localStorage.getItem(cfg.storageKey);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && d.v === 1) {
          d.global = clean(d.global);
          d.pages = d.pages && typeof d.pages === 'object' ? d.pages : {};
          return d;
        }
      }
      return { v: 1, global: {}, pages: {} };
    } catch (e) {
      return memStore; // storage blocked: settings last for this page view only
    }
  };

  const save = (d) => {
    memStore = d;
    try {
      win.localStorage.setItem(cfg.storageKey, JSON.stringify(d));
    } catch (e) {}
  };

  /* ───────────────────────── Page identity & rules ───────────────────────── */

  const pageKey = () => {
    try {
      if (typeof cfg.pageKey === 'function') return String(cfg.pageKey(win.location));
    } catch (e) {}
    let p = win.location.pathname.replace(/\/index\.html?$/i, '/');
    if (p.length > 1) p = p.replace(/\/+$/, '');
    return p || '/';
  };

  const globToRe = (g) =>
    new RegExp(
      '^' +
        g
          .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
          .replace(/\*\*/g, '\u0000')
          .replace(/\*/g, '[^/]*')
          .replace(/\u0000/g, '.*') +
        '$'
    );

  const matches = (m) => {
    const loc = win.location;
    try {
      if (Array.isArray(m)) return m.some(matches);
      if (m instanceof RegExp) return m.test(loc.pathname);
      if (typeof m === 'function') return !!m(loc);
      if (typeof m === 'string') return globToRe(m).test(loc.pathname);
    } catch (e) {}
    return false;
  };

  const resolve = () => {
    const store = load();
    const key = pageKey();
    const s = Object.assign({}, BASE, SYS, clean(cfg.defaults));
    const forced = {};
    (Array.isArray(cfg.pageRules) ? cfg.pageRules : []).forEach((r) => {
      if (!r || !matches(r.match)) return;
      const c = clean(r.settings);
      Object.assign(r.force ? forced : s, c);
    });
    Object.assign(s, store.global, clean(store.pages[key]));
    Object.assign(s, forced);
    return { settings: s, key, store, locked: Object.keys(forced) };
  };

  /* ───────────────────────── Page-level CSS ───────────────────────── */

  const EX = cfg.excludeSelector;
  const NOT = EX ? `:where(:not(${EX}))` : '';
  const NOT_MEDIA = `:where(:not(${[EX, 'img, video, canvas, picture, iframe'].filter(Boolean).join(', ')}))`;

  // OpenDyslexic (SIL Open Font License 1.1).
  // Regular and bold are fetched by script (ensureFont, below) so they can be kept in
  // localStorage. Italics, and every face when scripted loading isn't possible, are plain
  // @font-face rules: the browser only downloads those if text on the page uses them.
  const FACES = [
    { w: 400, s: 'normal', local: ['OpenDyslexic', 'OpenDyslexic-Regular'] },
    { w: 700, s: 'normal', local: ['OpenDyslexic Bold', 'OpenDyslexic-Bold'] },
    { w: 400, s: 'italic', local: ['OpenDyslexic Italic', 'OpenDyslexic-Italic'] },
    { w: 700, s: 'italic', local: ['OpenDyslexic Bold Italic', 'OpenDyslexic-BoldItalic'] },
  ];

  const fontBase = (() => {
    const b = typeof cfg.fontBase === 'string' ? cfg.fontBase.replace(/["'\\()\s]/g, '') : '';
    return b ? (b.endsWith('/') ? b : b + '/') : '';
  })();
  const faceUrl = (f, ext) => `${fontBase}opendyslexic-latin-${f.w}-${f.s}.${ext}`;
  const faceCSS = (f) =>
    `@font-face { font-family: "OpenDyslexic"; font-style: ${f.s}; font-weight: ${f.w}; font-display: swap; ` +
    `src: ${f.local.map((n) => `local("${n}")`).join(', ')}, url("${faceUrl(f, 'woff2')}") format("woff2"), ` +
    `url("${faceUrl(f, 'woff')}") format("woff"); }`;

  // Can we fetch the font ourselves and keep it in localStorage?
  const CAN_CACHE = !!(fontBase && cfg.fontCache !== false && win.FontFace && doc.fonts && win.fetch && win.Promise);
  const scripted = (f) => CAN_CACHE && f.s === 'normal';
  const fontFaceCSS = () => (fontBase ? FACES.filter((f) => !scripted(f)).map(faceCSS).join('\n') : '');

  const fontKey = (f) => `${cfg.storageKey}:font:${f.w}-${f.s}`;
  const toB64 = (buf) => {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return win.btoa(bin);
  };
  const fromB64 = (b64) => {
    const bin = win.atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  };
  const readFont = (f) => {
    try {
      const o = JSON.parse(win.localStorage.getItem(fontKey(f)) || 'null');
      if (o && o.u === faceUrl(f, 'woff2') && typeof o.d === 'string') return fromB64(o.d);
    } catch (e) {}
    return null;
  };
  const writeFont = (f, buf) => {
    try {
      win.localStorage.setItem(fontKey(f), JSON.stringify({ u: faceUrl(f, 'woff2'), d: toB64(buf) }));
    } catch (e) {} // storage full or blocked: the font still works, it just isn't kept
  };
  const dropFont = (f) => {
    try {
      win.localStorage.removeItem(fontKey(f));
    } catch (e) {}
  };

  let fontStarted = false;

  // Runs once, the first time the OpenDyslexic option is active on this page.
  // Saved copy found → use it, no network. Otherwise download it, save it, use it.
  // Anything fails (offline, CSP, bad file) → hand that face to the browser as a normal @font-face.
  const ensureFont = () => {
    if (fontStarted || !CAN_CACHE) return;
    fontStarted = true;
    FACES.filter(scripted).forEach((f) => {
      const show = (buf) => {
        const ff = new win.FontFace('OpenDyslexic', buf, { weight: String(f.w), style: f.s, display: 'swap' });
        doc.fonts.add(ff);
        return ff.load();
      };
      const download = () =>
        win
          .fetch(faceUrl(f, 'woff2'), { mode: 'cors', credentials: 'omit' })
          .then((r) => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.arrayBuffer();
          })
          .then((buf) => {
            writeFont(f, buf);
            return show(buf);
          });
      const fallback = () => {
        const st = doc.createElement('style');
        if (script && script.nonce) st.nonce = script.nonce;
        st.textContent = faceCSS(f);
        (doc.head || root).appendChild(st);
      };
      const saved = readFont(f);
      if (saved) {
        try {
          show(saved)
            .catch(() => {
              dropFont(f); // saved copy was damaged: replace it
              return download();
            })
            .catch(fallback);
          return;
        } catch (e) {
          dropFont(f);
        }
      }
      download().catch(fallback);
    });
  };

  const cursorSvg = (fill) =>
    'data:image/svg+xml,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24"><path d="M4 2l16 9-7 2 4 8-3 1.5-4-8-5 5z" fill="${fill}" stroke="white" stroke-width="1.4" stroke-linejoin="round"/></svg>`
    );

  const contrastCSS = (n, bg, fg, link) => `
html.a11y-contrast-${n}, html.a11y-contrast-${n} body { background: ${bg} !important; color: ${fg} !important; }
html.a11y-contrast-${n} body *${NOT_MEDIA} {
  background-color: ${bg} !important; background-image: none !important; color: ${fg} !important;
  border-color: ${fg} !important; text-shadow: none !important; box-shadow: none !important;
}
html.a11y-contrast-${n} body :is(a, a *) { color: ${link} !important; }
html.a11y-contrast-${n} body a { text-decoration: underline !important; }
html.a11y-contrast-${n} ::placeholder { color: ${fg} !important; opacity: .8 !important; }`;

  const PAGE_CSS = `
/* text size */
html.a11y-scale:not(.a11y-zoom) { font-size: calc(var(--a11y-scale) * 100%) !important; }
html.a11y-scale.a11y-zoom body { zoom: var(--a11y-scale); }

/* text spacing */
html.a11y-lh body *${NOT} { line-height: var(--a11y-lh) !important; }
html.a11y-ls body *${NOT} { letter-spacing: var(--a11y-ls) !important; }
html.a11y-ws body *${NOT} { word-spacing: var(--a11y-ws) !important; }
html.a11y-left body :is(p, li, dd, dt, blockquote, h1, h2, h3, h4, h5, h6, td, th, figcaption, article, section, div) { text-align: left !important; }

/* fonts */
${fontFaceCSS()}
html.a11y-font-dyslexia body *${NOT} { font-family: "OpenDyslexic", "Atkinson Hyperlegible", "Lexend", "Comic Sans MS", "Trebuchet MS", Verdana, sans-serif !important; }
html.a11y-font-sans body *${NOT} { font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important; }

/* colour */
${contrastCSS('dark', '#000', '#fff', '#8ab8ff')}
${contrastCSS('light', '#fff', '#000', '#0000d6')}
${contrastCSS('yellow', '#000', '#ffe600', '#5ce1ff')}
html.a11y-sat-gray { filter: grayscale(1); }
html.a11y-sat-low { filter: saturate(.4); }

/* navigation aids */
html.a11y-links body a[href] { text-decoration: underline !important; text-underline-offset: .18em; outline: 2px solid #ffbf47 !important; outline-offset: 2px; background-color: rgba(255,191,71,.2) !important; }
html.a11y-headings body :is(h1, h2, h3, h4, h5, h6, [role="heading"]) { outline: 2px dashed #3b82f6 !important; outline-offset: 4px; }
html.a11y-focus :focus-visible { outline: 3px solid #ffbf47 !important; outline-offset: 3px !important; box-shadow: 0 0 0 6px rgba(0,0,0,.85) !important; }
html.a11y-cursor, html.a11y-cursor body * { cursor: url("${cursorSvg('black')}") 4 2, auto !important; }
html.a11y-cursor body :is(a, button, [role="button"], input, select, summary, label) { cursor: url("${cursorSvg('gold')}") 4 2, pointer !important; }

/* motion */
html.a11y-motion *, html.a11y-motion *::before, html.a11y-motion *::after {
  animation-duration: .001ms !important; animation-iteration-count: 1 !important; animation-delay: 0s !important;
  transition-duration: .001ms !important; transition-delay: 0s !important; scroll-behavior: auto !important;
}`;

  const injectStyle = () => {
    if (doc.getElementById('a11y-style')) return;
    const st = doc.createElement('style');
    st.id = 'a11y-style';
    if (script && script.nonce) st.nonce = script.nonce;
    st.textContent = PAGE_CSS;
    (doc.head || root).appendChild(st);
  };

  /* ───────────────────────── Applying settings ───────────────────────── */

  let guide = null;
  let guideMove = null;
  let guideFrame = 0;

  const setGuide = (on) => {
    if (on && !guide) {
      guide = doc.createElement('div');
      guide.setAttribute('aria-hidden', 'true');
      guide.style.cssText =
        'position:fixed;left:0;right:0;top:-100px;height:44px;pointer-events:none;z-index:2147483646;' +
        'background:rgba(255,230,0,.16);border-top:2px solid #ffbf47;border-bottom:2px solid #ffbf47;';
      root.appendChild(guide);
      guideMove = (e) => {
        if (guideFrame) return;
        const y = e.clientY;
        guideFrame = win.requestAnimationFrame(() => {
          guideFrame = 0;
          if (guide) guide.style.top = y - 22 + 'px';
        });
      };
      doc.addEventListener('pointermove', guideMove, { passive: true });
    } else if (!on && guide) {
      doc.removeEventListener('pointermove', guideMove);
      guide.remove();
      guide = guideMove = null;
    }
  };

  const pauseVideos = () =>
    doc.querySelectorAll('video[autoplay]').forEach((v) => {
      try {
        v.pause();
      } catch (e) {}
    });

  const apply = (s) => {
    const flag = (name, on) => root.classList.toggle('a11y-' + name, !!on);
    const style = root.style;
    style.setProperty('--a11y-scale', s.textScale);
    style.setProperty('--a11y-lh', s.lineHeight);
    style.setProperty('--a11y-ls', s.letterSpacing + 'em');
    style.setProperty('--a11y-ws', s.wordSpacing + 'em');

    flag('scale', s.textScale !== 1);
    flag('zoom', cfg.scaleMethod === 'zoom');
    flag('lh', s.lineHeight > 0);
    flag('ls', s.letterSpacing > 0);
    flag('ws', s.wordSpacing > 0);
    flag('left', s.alignLeft);
    ENUM.font.slice(1).forEach((f) => flag('font-' + f, s.font === f));
    ENUM.contrast.slice(1).forEach((c) => flag('contrast-' + c, s.contrast === c));
    flag('sat-gray', s.saturation === 'grayscale');
    flag('sat-low', s.saturation === 'low');
    flag('links', s.highlightLinks);
    flag('headings', s.highlightHeadings);
    flag('focus', s.focusRing);
    flag('cursor', s.bigCursor);
    flag('motion', s.reduceMotion);

    setGuide(s.readingGuide);
    if (s.reduceMotion) pauseVideos();
    if (s.font === 'dyslexia') ensureFont();
  };

  /* ───────────────────────── Public operations ───────────────────────── */

  let ui = null;
  let lastKey = null;

  const refresh = () => {
    const r = resolve();
    apply(r.settings);
    if (ui) ui.sync(r);
    lastKey = r.key;
    doc.dispatchEvent(new CustomEvent('a11y:change', { detail: { settings: r.settings, page: r.key } }));
    return r;
  };

  const set = (patch, opts) => {
    const scope = opts && opts.scope === 'page' ? 'page' : 'global';
    const c = clean(patch);
    const store = load();
    const key = pageKey();
    if (scope === 'page') store.pages[key] = Object.assign(clean(store.pages[key]), c);
    else store.global = Object.assign(store.global, c);
    save(store);
    return refresh().settings;
  };

  const reset = (opts) => {
    const scope = (opts && opts.scope) || 'global';
    const store = load();
    if (scope === 'page' || scope === 'all') delete store.pages[pageKey()];
    if (scope === 'global' || scope === 'all') store.global = {};
    if (scope === 'all') store.pages = {};
    save(store);
    return refresh().settings;
  };

  const onChange = (fn) => {
    const h = (e) => fn(e.detail.settings, e.detail.page);
    doc.addEventListener('a11y:change', h);
    return () => doc.removeEventListener('a11y:change', h);
  };

  const open = () => {
    mountUI();
    if (ui) ui.open();
  };
  const close = () => ui && ui.close();
  const toggle = () => {
    mountUI();
    if (ui) ui.toggle();
  };

  /* ───────────────────────── Panel UI (Shadow DOM) ───────────────────────── */

  const CONTROLS = [
    {
      group: 'Text',
      items: [
        { key: 'textScale', label: 'Text size', type: 'stepper', min: 1, max: 2, step: 0.1, fmt: (v) => Math.round(v * 100) + '%' },
        { key: 'lineHeight', label: 'Line spacing', type: 'select', options: [[0, 'Site default'], [1.5, 'Comfortable'], [1.8, 'Wide'], [2.2, 'Extra wide']] },
        { key: 'letterSpacing', label: 'Letter spacing', type: 'select', options: [[0, 'Site default'], [0.05, 'Slight'], [0.1, 'Wide'], [0.16, 'Extra wide']] },
        { key: 'wordSpacing', label: 'Word spacing', type: 'select', options: [[0, 'Site default'], [0.1, 'Slight'], [0.2, 'Wide'], [0.3, 'Extra wide']] },
        { key: 'font', label: 'Font', type: 'select', options: [['off', 'Site default'], ['dyslexia', 'OpenDyslexic'], ['sans', 'Plain sans-serif']] },
        { key: 'alignLeft', label: 'Left-align text', type: 'switch' },
      ],
    },
    {
      group: 'Colour',
      items: [
        { key: 'contrast', label: 'Contrast', type: 'select', options: [['off', 'Site default'], ['dark', 'White on black'], ['light', 'Black on white'], ['yellow', 'Yellow on black']] },
        { key: 'saturation', label: 'Colour saturation', type: 'select', options: [['normal', 'Normal'], ['low', 'Muted'], ['grayscale', 'Greyscale']] },
      ],
    },
    {
      group: 'Reading and navigation',
      items: [
        { key: 'highlightLinks', label: 'Highlight links', type: 'switch' },
        { key: 'highlightHeadings', label: 'Highlight headings', type: 'switch' },
        { key: 'focusRing', label: 'Stronger keyboard focus', type: 'switch' },
        { key: 'readingGuide', label: 'Reading guide', type: 'switch' },
        { key: 'bigCursor', label: 'Large cursor', type: 'switch' },
      ],
    },
    {
      group: 'Motion',
      items: [{ key: 'reduceMotion', label: 'Reduce motion and pause video', type: 'switch' }],
    },
  ];

  const UI_CSS = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
.wrap {
  --bg: #fff; --fg: #15181f; --mut: #556070; --line: #d3d9e3; --acc: #14508c; --accfg: #fff; --surf: #f2f5f9; --warn: #b45309;
  position: fixed; z-index: 2147483647; width: 48px; height: 48px; color: var(--fg);
  font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
@media (prefers-color-scheme: dark) {
  .wrap { --bg: #171b24; --fg: #eef1f7; --mut: #a6b0c3; --line: #2e3647; --acc: #7fb2f0; --accfg: #08111f; --surf: #1f2532; --warn: #f5b942; }
}
.wrap[data-v="bottom"] { bottom: calc(16px + env(safe-area-inset-bottom, 0px)); }
.wrap[data-v="top"] { top: calc(16px + env(safe-area-inset-top, 0px)); }
.wrap[data-h="right"] { right: calc(16px + env(safe-area-inset-right, 0px)); }
.wrap[data-h="left"] { left: calc(16px + env(safe-area-inset-left, 0px)); }

.fab {
  all: unset; box-sizing: border-box; width: 48px; height: 48px; border-radius: 50%;
  background: var(--acc); color: var(--accfg); display: grid; place-items: center; cursor: pointer;
  box-shadow: 0 3px 12px rgba(0, 0, 0, .3);
}
.fab:hover { filter: brightness(1.1); }
:is(.fab, button, select, input):focus-visible { outline: 3px solid var(--fg); outline-offset: 2px; }

.panel {
  position: absolute; width: 344px; max-width: calc(100vw - 32px);
  max-height: min(680px, calc(100vh - 96px)); overflow: auto;
  background: var(--bg); border: 1px solid var(--line); border-radius: 12px;
  box-shadow: 0 10px 36px rgba(0, 0, 0, .3); padding: 0 16px 16px;
}
.wrap[data-v="bottom"] .panel { bottom: 60px; }
.wrap[data-v="top"] .panel { top: 60px; }
.wrap[data-h="right"] .panel { right: 0; }
.wrap[data-h="left"] .panel { left: 0; }

.pop {
  position: absolute; width: 250px; max-width: calc(100vw - 32px); padding: 12px 40px 12px 14px;
  background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 12px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, .28); font-size: 14px; animation: pop-in .25s ease-out;
}
.pop p { margin: 0; }
.pop-t { font-weight: 650; }
.pop::after { content: ""; position: absolute; width: 12px; height: 12px; background: var(--bg); transform: rotate(45deg); }
.wrap[data-v="bottom"] .pop { bottom: 60px; }
.wrap[data-v="top"] .pop { top: 60px; }
.wrap[data-h="right"] .pop { right: 0; }
.wrap[data-h="left"] .pop { left: 0; }
.wrap[data-v="bottom"] .pop::after { bottom: -7px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.wrap[data-v="top"] .pop::after { top: -7px; border-left: 1px solid var(--line); border-top: 1px solid var(--line); }
.wrap[data-h="right"] .pop::after { right: 18px; }
.wrap[data-h="left"] .pop::after { left: 18px; }
.px { font: inherit; color: inherit; background: none; border: 0; border-radius: 8px; position: absolute; top: 4px; right: 4px; width: 32px; height: 32px; cursor: pointer; }
.px:hover { background: var(--surf); }
@keyframes pop-in { from { opacity: 0; } to { opacity: 1; } }

.hd { position: sticky; top: 0; z-index: 1; background: var(--bg); display: flex; align-items: center; justify-content: space-between; padding: 14px 0 10px; }
h2 { margin: 0; font-size: 18px; font-weight: 650; }
fieldset { border: 0; margin: 0 0 14px; padding: 0; min-width: 0; }
legend { padding: 0; margin-bottom: 4px; font-size: 14px; font-weight: 650; color: var(--mut); }

.ai { margin: 0 0 14px; padding: 10px 10px 10px 12px; font-size: 14px; background: var(--surf); border: 1px solid var(--line); border-left: 4px solid var(--warn); border-radius: 8px; }

.scope { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.scope legend { grid-column: 1 / -1; }
.scope label { display: flex; gap: 8px; align-items: center; min-height: 44px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surf); cursor: pointer; }
.scope input { accent-color: var(--acc); margin: 0; }

.row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 48px; border-bottom: 1px solid var(--line); }
.row:last-child { border-bottom: 0; }
.lbl { flex: 1; }
select { font: inherit; color: inherit; background: var(--surf); border: 1px solid var(--line); border-radius: 8px; padding: 8px; max-width: 172px; min-height: 40px; }
.stepper { display: flex; align-items: center; gap: 6px; }
output { min-width: 48px; text-align: center; font-variant-numeric: tabular-nums; }

.stp, .btn, .x { font: inherit; color: inherit; background: var(--surf); border: 1px solid var(--line); border-radius: 8px; min-width: 44px; min-height: 40px; padding: 0 12px; cursor: pointer; }
.stp:hover, .btn:hover, .x:hover { border-color: var(--acc); }
button:disabled, select:disabled, input:disabled { opacity: .5; cursor: not-allowed; }

.sw { appearance: none; -webkit-appearance: none; flex: none; margin: 0; width: 46px; height: 26px; border-radius: 13px; background: var(--line); position: relative; cursor: pointer; transition: background .15s; }
.sw::after { content: ""; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: transform .15s; }
.sw:checked { background: var(--acc); }
.sw:checked::after { transform: translateX(20px); }

.note { margin: 0 0 14px; padding: 10px; font-size: 14px; background: var(--surf); border: 1px solid var(--line); border-radius: 8px; }
.link { font: inherit; color: var(--acc); background: none; border: 0; padding: 0; text-decoration: underline; cursor: pointer; }
.ft { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px; }
.sr { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
@media (forced-colors: active) { .sw::after { background: CanvasText; } .sw:checked { background: Highlight; } }`;

  const h = (tag, props, ...kids) => {
    const el = doc.createElement(tag);
    for (const k in props || {}) {
      const v = props[k];
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach((c) => c != null && c !== false && el.append(c));
    return el;
  };

  let lastSelection = '';
  doc.addEventListener('selectionchange', () => {
    const t = String(win.getSelection() || '').trim();
    if (t) lastSelection = t;
  });

  const mountUI = () => {
    if (ui || !cfg.ui) return;

    const [vRaw, hRaw] = String(cfg.position).split('-');
    const host = doc.createElement('div');
    host.id = 'a11y-root';
    const sr = host.attachShadow({ mode: 'open' });
    const hint = cfg.hotkey ? ` (${cfg.hotkey})` : '';

    sr.innerHTML = `
<style>${UI_CSS}</style>
<div class="wrap" data-v="${vRaw === 'top' ? 'top' : 'bottom'}" data-h="${hRaw === 'left' ? 'left' : 'right'}">
  <button type="button" class="fab" aria-haspopup="dialog" aria-expanded="false" aria-controls="panel"
          aria-label="Accessibility settings" title="Accessibility settings${hint}">
    <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="4.4" r="2.2"/>
      <path d="M4 8.4l8 1.6 8-1.6v2.1l-5.5 1.2v3.2l2 6.6h-2.2L12 15.5 9.7 21.5H7.5l2-6.6v-3.2L4 10.5z"/>
    </svg>
  </button>
  <div class="pop" hidden>
    <p class="pop-t"></p>
    <p class="pop-b"></p>
    <button type="button" class="px" aria-label="Dismiss tip">✕</button>
  </div>
  <section class="panel" id="panel" role="dialog" aria-labelledby="ttl" aria-describedby="ai-note" hidden>
    <div class="hd">
      <h2 id="ttl">${TITLE}</h2>
      <button type="button" class="x" aria-label="Close accessibility settings">✕</button>
    </div>
    <p class="ai" id="ai-note"><strong>Warning:</strong> <span class="ai-txt"></span></p>
    <fieldset class="scope">
      <legend>Apply changes to</legend>
      <label><input type="radio" name="scope" value="global"><span>All pages</span></label>
      <label><input type="radio" name="scope" value="page"><span>This page only</span></label>
    </fieldset>
    <p class="note" hidden>This page has its own settings, which override these.
      <button type="button" class="link" data-act="clear-page">Use my all-pages settings here</button></p>
    <div class="groups"></div>
    <div class="ft">
      <button type="button" class="btn" data-act="reset">Reset</button>
      <button type="button" class="btn" data-act="speak">Read selection aloud</button>
    </div>
    <p class="sr" role="status" aria-live="polite"></p>
  </section>
</div>`;

    const $ = (s) => sr.querySelector(s);
    const wrap = $('.wrap');
    const fab = $('.fab');
    const panel = $('.panel');
    const pop = $('.pop');
    const note = $('.note');
    const live = $('.sr');
    const radios = [...sr.querySelectorAll('input[name="scope"]')];
    const controls = [];

    // Set as text (not HTML) so a custom notice can't inject markup.
    $('.ai-txt').textContent =
      typeof cfg.aiNotice === 'string' && cfg.aiNotice.trim() ? cfg.aiNotice.trim() : DEFAULT_AI_NOTICE;

    $('.pop-t').textContent = TITLE;
    $('.pop-b').textContent =
      typeof cfg.popupText === 'string' && cfg.popupText.trim() ? cfg.popupText.trim() : DEFAULT_POPUP_TEXT;

    const initial = resolve();
    let uiScope = Object.keys(clean(initial.store.pages[initial.key])).length ? 'page' : 'global';

    const announce = (msg) => {
      live.textContent = '';
      setTimeout(() => (live.textContent = msg), 30);
    };
    const commit = (key, val) => set({ [key]: val }, { scope: uiScope });

    const build = (it) => {
      const id = 'c-' + it.key;
      if (it.type === 'switch') {
        const input = h('input', { type: 'checkbox', role: 'switch', class: 'sw', id, onchange: () => commit(it.key, input.checked) });
        controls.push({ key: it.key, update: (v, l) => { input.checked = !!v; input.disabled = l; input.title = l ? 'Set by this page' : ''; } });
        return h('div', { class: 'row' }, h('label', { for: id, class: 'lbl' }, it.label), input);
      }
      if (it.type === 'select') {
        const numeric = typeof BASE[it.key] === 'number';
        const sel = h('select', { id, onchange: () => commit(it.key, numeric ? Number(sel.value) : sel.value) },
          it.options.map(([v, t]) => h('option', { value: String(v) }, t)));
        controls.push({ key: it.key, update: (v, l) => { sel.value = String(v); sel.disabled = l; sel.title = l ? 'Set by this page' : ''; } });
        return h('div', { class: 'row' }, h('label', { for: id, class: 'lbl' }, it.label), sel);
      }
      // stepper
      const out = h('output', { id, 'aria-live': 'polite' });
      const mk = (dir, txt, label) =>
        h('button', {
          type: 'button', class: 'stp', 'aria-label': label,
          onclick: () => commit(it.key, Math.round((resolve().settings[it.key] + dir * it.step) * 100) / 100),
        }, txt);
      const dec = mk(-1, 'A−', 'Decrease ' + it.label.toLowerCase());
      const inc = mk(1, 'A+', 'Increase ' + it.label.toLowerCase());
      controls.push({
        key: it.key,
        update: (v, l) => {
          out.textContent = it.fmt(v);
          dec.disabled = l || v <= it.min + 1e-9;
          inc.disabled = l || v >= it.max - 1e-9;
        },
      });
      return h('div', { class: 'row' },
        h('span', { class: 'lbl', id: id + '-l' }, it.label),
        h('div', { class: 'stepper', role: 'group', 'aria-labelledby': id + '-l' }, dec, out, inc));
    };

    const groups = $('.groups');
    CONTROLS.forEach((g) => groups.append(h('fieldset', null, h('legend', null, g.group), g.items.map(build))));

    const sync = (r) => {
      r = r || resolve();
      if (lastKey !== null && r.key !== lastKey) {
        uiScope = Object.keys(clean(r.store.pages[r.key])).length ? 'page' : 'global';
      }
      const locked = new Set(r.locked);
      const pageHas = Object.keys(clean(r.store.pages[r.key])).length > 0;
      radios.forEach((x) => (x.checked = x.value === uiScope));
      note.hidden = !(uiScope === 'global' && pageHas);
      controls.forEach((c) => c.update(r.settings[c.key], locked.has(c.key)));
    };

    // Tip bubble beside the button. Shows on page load (per the `popup` setting), stays for
    // `popupSeconds`, pauses while hovered or focused, and closes on ✕ or when the panel opens.
    const popMode =
      cfg.popup === false || cfg.popup === null || cfg.popup === 'never'
        ? null
        : ['always', 'once', 'session'].includes(cfg.popup) ? cfg.popup : 'session';
    const popKey = cfg.storageKey + ':tip';
    const popStore = () => (popMode === 'once' ? win.localStorage : win.sessionStorage);
    const popSeen = () => {
      try {
        return popMode !== 'always' && !!popStore().getItem(popKey);
      } catch (e) {
        return false;
      }
    };
    const popMark = () => {
      try {
        if (popMode !== 'always') popStore().setItem(popKey, '1');
      } catch (e) {}
    };
    const secs = Number(cfg.popupSeconds);
    const popMs = (Number.isFinite(secs) && secs > 0 ? secs : 10) * 1000;
    let popTimer = 0;
    let popLeft = 0;
    let popStart = 0;

    const hidePop = () => {
      const hadFocus = pop.contains(sr.activeElement);
      clearTimeout(popTimer);
      popTimer = 0;
      pop.hidden = true;
      if (hadFocus) fab.focus();
    };
    const popResume = () => {
      if (pop.hidden || popTimer) return;
      popStart = Date.now();
      popTimer = setTimeout(hidePop, Math.max(popLeft, Math.min(popMs, 2000)));
    };
    const popPause = () => {
      if (!popTimer) return;
      clearTimeout(popTimer);
      popTimer = 0;
      popLeft -= Date.now() - popStart;
    };
    const showPop = () => {
      if (!popMode || !panel.hidden || popSeen()) return;
      popMark();
      popLeft = popMs;
      pop.hidden = false;
      popResume();
    };

    const openPanel = () => {
      hidePop();
      panel.hidden = false;
      fab.setAttribute('aria-expanded', 'true');
      sync();
      const first = panel.querySelector('input:not(:disabled), select:not(:disabled), button:not(:disabled)');
      if (first) first.focus();
    };
    const closePanel = () => {
      const hadFocus = panel.contains(sr.activeElement);
      panel.hidden = true;
      fab.setAttribute('aria-expanded', 'false');
      if (hadFocus) fab.focus();
    };
    const togglePanel = () => (panel.hidden ? openPanel() : closePanel());

    const speak = () => {
      const synth = win.speechSynthesis;
      if (!synth) return announce('Reading aloud is not supported in this browser.');
      if (synth.speaking) {
        synth.cancel();
        return announce('Stopped reading.');
      }
      const text = String(win.getSelection() || '').trim() || lastSelection;
      if (!text) return announce('Select some text on the page first.');
      const u = new win.SpeechSynthesisUtterance(text);
      if (root.lang) u.lang = root.lang;
      synth.speak(u);
    };

    fab.addEventListener('click', togglePanel);
    $('.x').addEventListener('click', closePanel);
    $('.px').addEventListener('click', hidePop);
    pop.addEventListener('pointerenter', popPause);
    pop.addEventListener('pointerleave', popResume);
    pop.addEventListener('focusin', popPause);
    pop.addEventListener('focusout', popResume);
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !pop.hidden) hidePop();
      if (e.key === 'Escape' && !panel.hidden) {
        e.stopPropagation();
        closePanel();
      }
    });
    radios.forEach((x) =>
      x.addEventListener('change', () => {
        if (x.checked) {
          uiScope = x.value;
          sync();
          announce(uiScope === 'page' ? 'Changes now apply to this page only.' : 'Changes now apply to all pages.');
        }
      })
    );
    sr.addEventListener('click', (e) => {
      const act = e.target.closest && e.target.closest('[data-act]');
      if (!act) return;
      const a = act.getAttribute('data-act');
      if (a === 'reset') {
        reset({ scope: uiScope });
        announce(uiScope === 'page' ? 'This page’s settings were reset.' : 'All-pages settings were reset.');
      } else if (a === 'clear-page') {
        reset({ scope: 'page' });
        uiScope = 'global';
        sync();
        announce('This page now uses your all-pages settings.');
      } else if (a === 'speak') {
        speak();
      }
    });

    root.appendChild(host);
    ui = { open: openPanel, close: closePanel, toggle: togglePanel, sync, hint: showPop };
    sync();
  };

  /* ───────────────────────── Hotkey, sync, navigation ───────────────────────── */

  const hotkey = (() => {
    const parts = String(cfg.hotkey || '').split('+').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const key = parts.pop();
    if (!key || key.length !== 1) return null;
    return {
      code: /\d/.test(key) ? 'Digit' + key : 'Key' + key.toUpperCase(),
      alt: parts.includes('alt'),
      shift: parts.includes('shift'),
      ctrl: parts.includes('ctrl') || parts.includes('control'),
      meta: parts.includes('meta') || parts.includes('cmd'),
    };
  })();

  if (hotkey && cfg.ui) {
    doc.addEventListener(
      'keydown',
      (e) => {
        if (e.code === hotkey.code && e.altKey === hotkey.alt && e.shiftKey === hotkey.shift &&
            e.ctrlKey === hotkey.ctrl && e.metaKey === hotkey.meta) {
          e.preventDefault();
          toggle();
        }
      },
      true
    );
  }

  // Live-sync between open tabs.
  win.addEventListener('storage', (e) => {
    if (e.key === cfg.storageKey || e.key === null) refresh();
  });

  // Back/forward cache restores.
  win.addEventListener('pageshow', (e) => e.persisted && refresh());

  // Single-page apps: re-resolve page rules when the URL changes without a reload.
  try {
    ['pushState', 'replaceState'].forEach((fn) => {
      const orig = win.history[fn];
      win.history[fn] = function () {
        const result = orig.apply(this, arguments);
        win.dispatchEvent(new Event('a11y:navigate'));
        return result;
      };
    });
    win.addEventListener('a11y:navigate', refresh);
    win.addEventListener('popstate', refresh);
  } catch (e) {}

  /* ───────────────────────── Boot ───────────────────────── */

  win.A11y = {
    __loaded: true,
    version: '1.2.0',
    get: () => resolve().settings,
    set,
    reset,
    open,
    close,
    toggle,
    onChange,
    pageKey,
  };

  injectStyle();
  refresh(); // apply immediately, before the body exists, to avoid a flash

  const ready = () => {
    mountUI();
    if (ui) ui.hint();
    if (resolve().settings.reduceMotion) pauseVideos();
  };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
})();