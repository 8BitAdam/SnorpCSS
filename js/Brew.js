/*! coffee-loader.js — drop-in CoffeeScript support for websites
 *
 * Usage:
 *   <script src="coffee-loader.js"></script>
 *
 * Examples:
 *   1. Custom tag (inline):    <coffee>console.log "hi"</coffee>
 *   2. Custom tag (external):  <coffee src="app.coffee"></coffee>
 *   3. Standard script import: <script src="app.coffee"></script>
 *   4. Explicit type tag:      <script type="text/coffeescript" src="app.coffee"></script>
 *   5. ES Module script:       <script src="app.coffee" module></script>
 *
 * Options (data-* on the loader's own <script> tag):
 *   data-compiler  URL of CoffeeScript browser compiler (default: pinned 2.7.0 on jsDelivr)
 *   data-cache     "false" to disable localStorage compile cache
 *   data-overlay   "auto" (default, localhost only) | "true" | "false"
 *   data-watch     poll .coffee files and reload on change; value = ms (default 1000)
 *
 * Attributes on <coffee> or <script> tags:
 *   bare / data-bare         compile without top-level function wrapper
 *   literate / data-literate treat as Literate CoffeeScript
 *   module / data-module     execute as an ES module (<script type="module">)
 */
(function (global) {
  'use strict';
  if (global.CoffeeLoader) return;

  var doc = global.document;
  var me = doc.currentScript;
  var noop = function () {};
  var cfg = function (n, d) { var v = me && me.getAttribute('data-' + n); return v == null ? d : v; };

  // Inject CSS to ensure <coffee> tags don't flash raw code on screen before compile
  var style = doc.createElement('style');
  style.textContent = 'coffee { display: none !important; }';
  (doc.head || doc.documentElement).appendChild(style);

  var COMPILER = cfg('compiler', 'https://cdn.jsdelivr.net/npm/coffeescript@2.7.0/lib/coffeescript-browser-compiler-legacy/coffeescript.js');
  var VERSION_KEY = global.CoffeeScript ? 'pre:' + global.CoffeeScript.VERSION : COMPILER;
  var USE_CACHE = cfg('cache', 'true') !== 'false';
  var OVERLAY = cfg('overlay', 'auto');
  var WATCH = me && me.hasAttribute('data-watch') ? (parseInt(me.getAttribute('data-watch'), 10) || 1000) : 0;
  
  var TYPE_RE = /^(text|application)\/(x-)?(literate-)?coffee(-?script)?$/i;
  var LIT_RE = /\.(litcoffee|coffee\.md)(\?|#|$)/i;
  var EXT_RE = /\.(coffee|litcoffee|coffee\.md)(\?|#|$)/i;

  var queue = Promise.resolve();   // keeps execution in document order
  var inlineCount = 0;
  var reloading = false;

  /* ---------- compiler ---------- */

  var compilerPromise;
  function loadCompiler() {
    if (global.CoffeeScript) return Promise.resolve(global.CoffeeScript);
    return compilerPromise || (compilerPromise = new Promise(function (ok, fail) {
      var s = doc.createElement('script');
      if (me && me.nonce) s.nonce = me.nonce;
      s.src = COMPILER;
      s.onload = function () {
        global.CoffeeScript ? ok(global.CoffeeScript) : fail(new Error('Compiler loaded but window.CoffeeScript is missing'));
      };
      s.onerror = function () { fail(new Error('Could not load the CoffeeScript compiler from ' + COMPILER)); };
      (doc.head || doc.documentElement).appendChild(s);
    }));
  }

  function b64(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  // Compile with an inline source map so DevTools shows real CoffeeScript.
  function translate(CS, code, task) {
    var out;
    try {
      out = CS.compile(code, {
        bare: !!task.bare, literate: !!task.literate,
        filename: task.name, sourceFiles: [task.name], sourceMap: true
      });
    } catch (e) {
      if (e.location) e.coffeeFrame = frame(code, e.location);
      e.coffeeTask = task;
      throw e;
    }
    var map = JSON.parse(out.v3SourceMap);
    map.sources = [task.name];
    map.sourcesContent = [code];
    return out.js + '\n//# sourceMappingURL=data:application/json;base64,' + b64(JSON.stringify(map)) +
           '\n//# sourceURL=' + task.name + '.js\n';
  }

  /* ---------- cache ---------- */

  function cacheKey(t) { 
    return 'coffee-loader:' + t.name + ':' + (t.bare ? 'b' : 'w') + (t.literate ? 'l' : '') + (t.isModule ? 'm' : ''); 
  }
  
  function cacheGet(t, code) {
    if (!USE_CACHE) return null;
    try {
      var hit = JSON.parse(global.localStorage.getItem(cacheKey(t)));
      return hit && hit.v === VERSION_KEY && hit.code === code ? hit.js : null;
    } catch (e) { return null; }
  }
  
  function cacheSet(t, code, js) {
    if (!USE_CACHE) return;
    try { global.localStorage.setItem(cacheKey(t), JSON.stringify({ v: VERSION_KEY, code: code, js: js })); } catch (e) {}
  }

  function build(task, code) {
    var cached = cacheGet(task, code);
    if (cached) return Promise.resolve(cached);
    return loadCompiler().then(function (CS) {
      var js = translate(CS, code, task);
      cacheSet(task, code, js);
      return js;
    });
  }

  /* ---------- running ---------- */

  function exec(js, nonce, isModule) {
    var s = doc.createElement('script');
    if (nonce) s.nonce = nonce;
    if (isModule) s.type = 'module';
    s.text = js;
    (doc.head || doc.documentElement).appendChild(s);
    if (!isModule) {
      s.parentNode && s.parentNode.removeChild(s);
    }
  }

  function claim(el) {
    if (el.__coffee) return null;
    
    var tag = el.tagName ? el.tagName.toUpperCase() : '';
    var isCoffeeTag = tag === 'COFFEE';
    var type = el.getAttribute('type') || '';
    var src = el.getAttribute('src') || '';

    var isCoffeeType = TYPE_RE.test(type);
    var isCoffeeExt = EXT_RE.test(src);

    if (!isCoffeeTag && !isCoffeeType && !isCoffeeExt) return null;

    el.__coffee = true;
    if (tag === 'SCRIPT') {
      el.setAttribute('type', 'text/x-coffee-claimed');
    }

    return {
      el: el, 
      src: src,
      bare: el.hasAttribute('bare') || el.hasAttribute('data-bare'),
      literate: /literate/i.test(type) || el.hasAttribute('literate') || el.hasAttribute('data-literate') || LIT_RE.test(src),
      isModule: type === 'module' || el.hasAttribute('module') || el.hasAttribute('data-module')
    };
  }

  function readSource(task) {
    if (!task.src) {
      task.name = 'inline-' + (++inlineCount) + '.coffee';
      return Promise.resolve(task.el.textContent);
    }
    task.url = task.name = new URL(task.src, doc.baseURI).href;
    return global.fetch(task.url, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('Failed to load ' + task.url + ' (HTTP ' + r.status + ')');
      return r.text();
    }, function (e) {
      throw new Error('Failed to load ' + task.url + ' — ' + e.message +
        (global.location.protocol === 'file:' ? ' (browsers block fetch() on file:// pages; use a local web server)' : ''));
    });
  }

  function schedule(el) {
    var task = claim(el);
    if (!task) return;
    var job = readSource(task);   // downloads start in parallel...
    job.catch(noop);
    queue = queue.then(function () { return job; })   // ...runs in document order
      .then(function (code) {
        return build(task, code).then(function (js) {
          exec(js, el.nonce, task.isModule);
          watch(task, code);
        });
      })
      .catch(function (e) { report(e, task); });
  }

  function watch(task, code) {
    if (!WATCH || !task.url) return;
    setInterval(function () {
      global.fetch(task.url, { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.text() : code; })
        .then(function (t) { if (t !== code && !reloading) { reloading = true; global.location.reload(); } })
        .catch(noop);
    }, WATCH);
  }

  /* ---------- errors ---------- */

  function frame(code, loc) {
    var lines = code.split('\n'), l = loc.first_line, out = [];
    var width = (loc.last_line === l ? loc.last_column - loc.first_column + 1 : 1);
    for (var i = Math.max(0, l - 2); i <= Math.min(lines.length - 1, l + 2); i++) {
      out.push((i === l ? '> ' : '  ') + ('    ' + (i + 1)).slice(-4) + ' | ' + lines[i]);
      if (i === l) out.push('        | ' + new Array(loc.first_column + 1).join(' ') + new Array(Math.max(1, width) + 1).join('^'));
    }
    return out.join('\n');
  }

  function report(e, task) {
    var name = (e.coffeeTask || task || {}).name || 'CoffeeScript';
    var where = e.location ? ':' + (e.location.first_line + 1) + ':' + (e.location.first_column + 1) : '';
    var text = name + where + '\n' + e.message + (e.coffeeFrame ? '\n\n' + e.coffeeFrame : '');
    console.error('[coffee-loader] ' + text);
    var host = global.location.hostname;
    var local = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|.*\.(local|test|localhost))$/.test(host);
    if (OVERLAY === 'true' || (OVERLAY === 'auto' && local)) overlay(text);
  }

  function overlay(text) {
    if (!doc.body) return;
    var box = doc.getElementById('coffee-loader-overlay');
    if (!box) {
      box = doc.createElement('pre');
      box.id = 'coffee-loader-overlay';
      box.title = 'Click to dismiss';
      box.style.cssText = 'position:fixed;z-index:2147483647;left:0;right:0;top:0;max-height:50vh;overflow:auto;' +
        'margin:0;padding:12px 16px;background:#2a0f12;color:#ffd6d6;border-bottom:3px solid #ff5c5c;cursor:pointer;' +
        'font:13px/1.45 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap';
      box.onclick = function () { box.parentNode && box.parentNode.removeChild(box); };
      doc.body.appendChild(box);
    }
    box.textContent += (box.textContent ? '\n\n' : '') + text;
  }

  /* ---------- boot ---------- */

  function scan() {
    Array.prototype.forEach.call(doc.querySelectorAll('script, coffee'), schedule);
  }

  function observe() {
    if (!global.MutationObserver) return;
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        Array.prototype.forEach.call(m.addedNodes, function (n) {
          if (n.nodeType !== 1) return;
          var tag = n.tagName.toUpperCase();
          if (tag === 'SCRIPT' || tag === 'COFFEE') schedule(n);
          else Array.prototype.forEach.call(n.querySelectorAll('script, coffee'), schedule);
        });
      });
    }).observe(doc.documentElement, { childList: true, subtree: true });
  }

  var ready = new Promise(function (resolve) {
    function go() {
      scan();
      observe();
      resolve(queue.then(function () { doc.dispatchEvent(new CustomEvent('coffeeready')); }));
    }
    doc.readyState === 'loading' ? doc.addEventListener('DOMContentLoaded', go) : go();
  });

  global.CoffeeLoader = {
    ready: ready,
    compile: function (code, o) {
      o = o || {};
      var task = { name: o.name || 'inline-' + (++inlineCount) + '.coffee', bare: !!o.bare, literate: !!o.literate };
      return loadCompiler().then(function (CS) { return translate(CS, code, task); });
    },
    run: function (code, o) {
      return this.compile(code, o).then(function (js) { exec(js, null, o && o.module); });
    }
  };
})(window);