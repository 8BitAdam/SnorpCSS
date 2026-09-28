/*!
 * a11y-autoload.js  v1.0.0
 * Drop-in accessibility layer that loads on every page, remembers each visitor's
 * settings across pages and tabs, and supports per-page overrides.
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
      // Elements the text/font/contrast overrides leave alone (icon fonts, code, SVG).
      excludeSelector:
        'svg, svg *, script, style, code, pre, kbd, samp, [class*="icon" i], [class*="fa-"], .material-icons, .material-symbols-outlined',
    },
    win.A11Y_CONFIG || {}
  );
  if (ds.storageKey) cfg.storageKey = ds.storageKey;
  if (ds.position) cfg.position = ds.position;
  if (ds.scaleMethod) cfg.scaleMethod = ds.scaleMethod;
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
        { key: 'font', label: 'Font', type: 'select', options: [['off', 'Site default'], ['dyslexia', 'Dyslexia-friendly'], ['sans', 'Plain sans-serif']] },
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
  --bg: #fff; --fg: #15181f; --mut: #556070; --line: #d3d9e3; --acc: #14508c; --accfg: #fff; --surf: #f2f5f9;
  position: fixed; z-index: 2147483647; width: 48px; height: 48px; color: var(--fg);
  font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
@media (prefers-color-scheme: dark) {
  .wrap { --bg: #171b24; --fg: #eef1f7; --mut: #a6b0c3; --line: #2e3647; --acc: #7fb2f0; --accfg: #08111f; --surf: #1f2532; }
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

.hd { position: sticky; top: 0; z-index: 1; background: var(--bg); display: flex; align-items: center; justify-content: space-between; padding: 14px 0 10px; }
h2 { margin: 0; font-size: 18px; font-weight: 650; }
fieldset { border: 0; margin: 0 0 14px; padding: 0; min-width: 0; }
legend { padding: 0; margin-bottom: 4px; font-size: 14px; font-weight: 650; color: var(--mut); }

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

@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
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
  <section class="panel" id="panel" role="dialog" aria-labelledby="ttl" hidden>
    <div class="hd">
      <h2 id="ttl">Accessibility</h2>
      <button type="button" class="x" aria-label="Close accessibility settings">✕</button>
    </div>
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
    const note = $('.note');
    const live = $('.sr');
    const radios = [...sr.querySelectorAll('input[name="scope"]')];
    const controls = [];

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

    const openPanel = () => {
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
    wrap.addEventListener('keydown', (e) => {
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
    ui = { open: openPanel, close: closePanel, toggle: togglePanel, sync };
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
    version: '1.0.0',
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
    if (resolve().settings.reduceMotion) pauseVideos();
  };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
})();