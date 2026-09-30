/*!
 * lazy-anything v1.0.0
 * Lazy load images, videos, iframes, audio and CSS backgrounds.
 * Opt out with data-lazyload="false". MIT License.
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    // <script> tag usage: auto-start unless window.LAZYLOAD_MANUAL is set
    var LL = (root.LazyLoad = factory());
    if (root.document && !root.LAZYLOAD_MANUAL) {
      var start = function () { LL.init(root.LAZYLOAD_OPTIONS); };
      if (root.document.readyState === 'loading') {
        root.document.addEventListener('DOMContentLoaded', start);
      } else {
        start();
      }
    }
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const OPT = 'data-lazyload';
  const OFF = /^(false|0|off|no)$/i;
  const DATA = '[data-src],[data-srcset],[data-poster],[data-bg]';
  const SCAN = DATA + ',img,iframe,video,audio';
  const SWAP = ['sizes', 'srcset', 'src', 'poster']; // sizes/srcset must be set before src

  const DEFAULTS = {
    root: null,                 // scroll container (null = viewport)
    rootMargin: '200px 0px',    // start loading this far before it's visible
    threshold: 0.01,
    native: true,               // plain src="" images/iframes/videos get loading="lazy" / preload="none"
    observe: true,              // watch the DOM for elements added later
    loadingClass: 'lazy-loading',
    loadedClass: 'lazy-loaded',
    errorClass: 'lazy-error',
    onLoad: null,               // (el) => void
    onError: null               // (el) => void
  };

  // ---- helpers -----------------------------------------------------------

  // data-lazyload="false" on the element OR the nearest ancestor that sets it
  const isOff = (el) => {
    const holder = el.closest('[' + OPT + ']');
    return !!holder && OFF.test(holder.getAttribute(OPT).trim());
  };

  const cssImage = (v) =>
    /^\s*(url|image-set|(?:-webkit-)?(?:repeating-)?(?:linear|radial|conic)-gradient)\(/i.test(v)
      ? v
      : 'url("' + v.trim().replace(/"/g, '%22') + '")';

  // <source> tags are loaded through their parent media element
  const hostOf = (el) => {
    if (el.tagName !== 'SOURCE') return el;
    const p = el.parentElement;
    if (!p) return null;
    return p.tagName === 'PICTURE' ? p.querySelector('img') : p;
  };

  const sourcesOf = (el) => {
    const p = el.parentElement;
    if (el.tagName === 'IMG' && p && p.tagName === 'PICTURE') return Array.from(p.querySelectorAll('source'));
    if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') return Array.from(el.querySelectorAll('source'));
    return [];
  };

  const hasLazyData = (el) => {
    if (el.matches(DATA)) return true;
    const p = el.parentElement;
    const scope = el.tagName === 'IMG' && p && p.tagName === 'PICTURE' ? p : el;
    return !!scope.querySelector('source[data-src],source[data-srcset]');
  };

  // data-src -> src, data-srcset -> srcset, etc. Returns true if anything moved.
  const swap = (node) => {
    let changed = false;
    for (const a of SWAP) {
      const v = node.getAttribute('data-' + a);
      if (v) {
        node.setAttribute(a, v);
        node.removeAttribute('data-' + a);
        changed = true;
      }
    }
    return changed;
  };

  // ---- LazyLoad ----------------------------------------------------------

  class LazyLoad {
    constructor(options) {
      this.options = Object.assign({}, DEFAULTS, options);
      this._seen = new WeakSet();
      this._io = null;
      this._mo = null;
      if (typeof window === 'undefined' || typeof document === 'undefined') return; // SSR-safe

      const o = this.options;
      if ('IntersectionObserver' in window) {
        this._io = new window.IntersectionObserver((entries) => this._onIntersect(entries), {
          root: o.root,
          rootMargin: o.rootMargin,
          threshold: o.threshold
        });
      }

      this.update(document);

      if (o.observe && 'MutationObserver' in window) {
        this._mo = new window.MutationObserver((muts) => {
          for (const m of muts) {
            for (const n of m.addedNodes) if (n.nodeType === 1) this.update(n);
          }
        });
        this._mo.observe(document.documentElement, { childList: true, subtree: true });
      }
    }

    /** Scan a subtree (default: whole document) for new lazy elements. */
    update(scope) {
      if (typeof document === 'undefined') return this;
      scope = scope || document;
      const nodes = [];
      if (scope.nodeType === 1 && scope.matches(SCAN)) nodes.push(scope);
      if (scope.querySelectorAll) nodes.push(...scope.querySelectorAll(SCAN));

      for (const n of nodes) {
        const el = hostOf(n);
        if (!el || this._seen.has(el)) continue;
        this._seen.add(el);
        this._handle(el);
      }
      return this;
    }

    /** Force an element (or its <source> child) to load right now. */
    load(el) {
      const host = el && hostOf(el);
      if (!host) return;
      if (this._io) this._io.unobserve(host);
      this._seen.add(host);
      this._reveal(host);
    }

    destroy() {
      if (this._io) this._io.disconnect();
      if (this._mo) this._mo.disconnect();
      this._io = this._mo = null;
    }

    // ---- internals ----

    _handle(el) {
      if (!hasLazyData(el)) {
        if (this.options.native) this._native(el);
        return;
      }
      // data-lazyload="false" (or no IntersectionObserver): load right away
      if (isOff(el) || !this._io) return this._reveal(el);
      this._io.observe(el);
    }

    // Plain src="" elements: let the browser defer them, no markup changes needed
    _native(el) {
      if (isOff(el)) return;
      const t = el.tagName;
      if ((t === 'IMG' || t === 'IFRAME') && !el.hasAttribute('loading')) {
        el.setAttribute('loading', 'lazy');
      } else if ((t === 'VIDEO' || t === 'AUDIO') && !el.hasAttribute('preload') && !el.hasAttribute('autoplay')) {
        el.setAttribute('preload', 'none');
      }
    }

    _onIntersect(entries) {
      for (const e of entries) {
        if (e.isIntersecting || e.intersectionRatio > 0) {
          this._io.unobserve(e.target);
          this._reveal(e.target);
        }
      }
    }

    _reveal(el) {
      const o = this.options;
      const media = el.tagName === 'VIDEO' || el.tagName === 'AUDIO';
      const kids = sourcesOf(el);
      const hadSrc = el.hasAttribute('data-src');

      let kidsChanged = false;
      for (const s of kids) kidsChanged = swap(s) || kidsChanged;
      const changed = swap(el) || kidsChanged;

      const bg = el.getAttribute('data-bg');
      if (bg) {
        el.style.backgroundImage = cssImage(bg);
        el.removeAttribute('data-bg');
      }

      if (!changed) {
        if (bg) this._finish(el, true);
        return;
      }

      if (media && !(kidsChanged || hadSrc)) return this._finish(el, true); // poster only

      el.classList.add(o.loadingClass);
      el.addEventListener(media ? 'loadedmetadata' : 'load', () => this._finish(el, true), { once: true });
      if (media && kids.length) {
        // when every <source> fails, the error fires on the last one
        kids[kids.length - 1].addEventListener('error', () => this._finish(el, false), { once: true });
      } else {
        el.addEventListener('error', () => this._finish(el, false), { once: true });
      }
      if (media) el.load();
    }

    _finish(el, ok) {
      const o = this.options;
      el.classList.remove(o.loadingClass);
      el.classList.add(ok ? o.loadedClass : o.errorClass);
      el.dispatchEvent(new CustomEvent(ok ? 'lazyloaded' : 'lazyerror', { bubbles: true }));
      const cb = ok ? o.onLoad : o.onError;
      if (typeof cb === 'function') cb(el);
    }

    static init(options) {
      return (LazyLoad.instance = new LazyLoad(options));
    }
  }

  LazyLoad.default = LazyLoad;
  return LazyLoad;
});