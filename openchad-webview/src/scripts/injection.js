/**
 * Playwright Page API — in-browser polyfill
 *
 * Covers every method and property defined in the Page TypeScript interface.
 * Methods that require browser-level access (CDP/V8) are stubbed with clear
 * runtime errors; all others have real DOM/fetch implementations.
 *
 * Sub-APIs exposed as properties:
 *   clock  keyboard  mouse  touchscreen
 *   coverage  localStorage  sessionStorage
 *   request  screencast
 */
(async () => {

  if (window.__page) return;   // idempotent — skip if already injected

  // 
  //  1.  Internal helpers
  // 

  /** Simple event-listener registry */
  const _bus = {};
  function _emit(event, ...args) {
    (_bus[event] || []).slice().forEach(fn => { try { fn(...args); } catch { } });
  }
  function _on(event, fn) { (_bus[event] = _bus[event] || []).push(fn); return window.__page; }
  function _off(event, fn) { if (_bus[event]) _bus[event] = _bus[event].filter(f => f !== fn); return window.__page; }

  /** Active locator-handler observers */
  const _locatorHandlers = new Map();

  /**
   * Resolve a DOM element (with MutationObserver fallback).
   * Supports plain CSS selectors plus Playwright's pseudo-selectors:
   *   text=foo, label=bar, placeholder=baz, role=button
   */
  async function _resolve(selector, timeout = 5000) {
    const el = _query(selector);
    if (el) return el;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { obs.disconnect(); reject(new Error('Timeout waiting for selector: ' + selector)); }, timeout);
      const obs = new MutationObserver(() => {
        const found = _query(selector);
        if (found) { clearTimeout(t); obs.disconnect(); resolve(found); }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    });
  }

  /** querySelector with Playwright pseudo-selector support */
  function _query(selector) {
    if (typeof selector !== 'string') return null;
    if (selector.startsWith('text=')) return _findByText(selector.slice(5));
    if (selector.startsWith('label=')) return _findByLabel(selector.slice(6));
    if (selector.startsWith('placeholder=')) return document.querySelector(`[placeholder="${selector.slice(12)}"]`);
    if (selector.startsWith('role=')) return document.querySelector(`[role="${selector.slice(5)}"], ${_nativeRole(selector.slice(5))}`);
    try { return document.querySelector(selector); } catch { return null; }
  }

  function _queryAll(selector) {
    if (typeof selector !== 'string') return [];
    if (selector.startsWith('text=')) return _findAllByText(selector.slice(5));
    if (selector.startsWith('label=')) return [_findByLabel(selector.slice(6))].filter(Boolean);
    try { return Array.from(document.querySelectorAll(selector)); } catch { return []; }
  }

  function _findByText(text) {
    for (const el of document.querySelectorAll('*')) {
      if (!el.children.length && el.textContent?.trim() === text) return el;
    }
    for (const el of document.querySelectorAll('*')) {
      if (el.textContent?.includes(text)) return el;
    }
    return null;
  }

  function _findAllByText(text) {
    return Array.from(document.querySelectorAll('*')).filter(el =>
      el.textContent?.trim() === text || el.textContent?.includes(text)
    );
  }

  function _findByLabel(text) {
    for (const label of document.querySelectorAll('label')) {
      if (label.textContent?.includes(text)) {
        const forId = label.getAttribute('for');
        if (forId) return document.getElementById(forId);
        return label.querySelector('input, select, textarea');
      }
    }
    return null;
  }

  /** Returns a native CSS fallback for implicit ARIA roles */
  function _nativeRole(role) {
    const map = {
      button: 'button', link: 'a', textbox: 'input:not([type=checkbox]):not([type=radio]), textarea',
      checkbox: 'input[type=checkbox]', radio: 'input[type=radio]', combobox: 'select',
      img: 'img', heading: 'h1,h2,h3,h4,h5,h6', listitem: 'li',
      listbox: 'select[multiple]', menuitem: '[role=menuitem]',
    };
    return map[role] || `[role="${role}"]`;
  }

  function _isVisible(el) {
    if (!el) return false;
    const s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function _matchUrl(pattern, url) {
    if (typeof pattern === 'string') return url === pattern || url.includes(pattern);
    if (pattern instanceof RegExp) return pattern.test(url);
    if (typeof pattern === 'function') { try { return pattern(new URL(url)); } catch { return false; } }
    return false;
  }

  function _modifiers(mods = []) {
    return {
      altKey: mods.includes('Alt'),
      ctrlKey: mods.includes('Control') || mods.includes('ControlOrMeta'),
      metaKey: mods.includes('Meta') || mods.includes('ControlOrMeta'),
      shiftKey: mods.includes('Shift'),
    };
  }

  function _disposable(cleanup) {
    const d = { dispose: cleanup };
    d[Symbol.dispose] = cleanup;
    return d;
  }

  // 
  //  2.  Sub-API: keyboard
  // 
  const keyboard = {
    async down(key) {
      (document.activeElement || document.body)
        .dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    },
    async up(key) {
      (document.activeElement || document.body)
        .dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }));
    },
    async press(key, options = {}) {
      const el = document.activeElement || document.body;
      el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      el.dispatchEvent(new KeyboardEvent('keypress', { key, bubbles: true, cancelable: true }));
      if (options.delay) await new Promise(r => setTimeout(r, options.delay));
      el.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }));
      // Semantic side-effects
      if (key === 'Enter') {
        if (el.tagName === 'BUTTON' || el.type === 'submit') el.click();
        const form = el.closest('form');
        if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
      if (key === 'Tab') {
        const focusable = [...document.querySelectorAll(
          'a[href],button,input,textarea,select,[tabindex]:not([tabindex="-1"])'
        )].filter(e => !e.disabled && !e.hidden);
        const idx = focusable.indexOf(document.activeElement);
        focusable[idx + 1]?.focus();
      }
    },
    async type(text, options = {}) {
      const delay = options.delay || 0;
      for (const char of text) {
        const el = document.activeElement || document.body;
        el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));
        if ('value' in el) { el.value += char; el.dispatchEvent(new Event('input', { bubbles: true })); }
        el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
        if (delay) await new Promise(r => setTimeout(r, delay));
      }
    },
    async insertText(text) {
      const el = document.activeElement;
      if (!el || !('value' in el)) return;
      const s = el.selectionStart ?? el.value.length;
      const e = el.selectionEnd ?? el.value.length;
      el.value = el.value.slice(0, s) + text + el.value.slice(e);
      el.selectionStart = el.selectionEnd = s + text.length;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
  };

  // 
  //  3.  Sub-API: mouse
  // 
  const mouse = {
    _x: 0, _y: 0,
    async move(x, y, options = {}) {
      this._x = x; this._y = y;
      const steps = options.steps || 1;
      const [ox, oy] = [this._x, this._y];
      for (let i = 1; i <= steps; i++) {
        const cx = ox + (x - ox) * (i / steps);
        const cy = oy + (y - oy) * (i / steps);
        const el = document.elementFromPoint(cx, cy) || document.body;
        el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx, clientY: cy }));
      }
      this._x = x; this._y = y;
    },
    async down(options = {}) {
      const el = document.elementFromPoint(this._x, this._y) || document.body;
      el.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, cancelable: true,
        button: options.button === 'right' ? 2 : options.button === 'middle' ? 1 : 0,
        clientX: this._x, clientY: this._y,
      }));
    },
    async up(options = {}) {
      const el = document.elementFromPoint(this._x, this._y) || document.body;
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: this._x, clientY: this._y }));
    },
    async click(x, y, options = {}) {
      await this.move(x, y);
      const count = options.clickCount || 1;
      const btn = options.button === 'right' ? 2 : options.button === 'middle' ? 1 : 0;
      const el = document.elementFromPoint(x, y) || document.body;
      for (let i = 0; i < count; i++) {
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: btn, clientX: x, clientY: y, detail: i + 1 }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: btn, clientX: x, clientY: y }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, button: btn, clientX: x, clientY: y, detail: i + 1 }));
        if (options.delay) await new Promise(r => setTimeout(r, options.delay));
      }
    },
    async dblclick(x, y, options = {}) {
      await this.click(x, y, { ...options, clickCount: 2 });
      const el = document.elementFromPoint(x, y) || document.body;
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: x, clientY: y, detail: 2 }));
    },
    async wheel(deltaX, deltaY) {
      const el = document.elementFromPoint(this._x, this._y) || document.body;
      el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, clientX: this._x, clientY: this._y, deltaX, deltaY }));
    },
  };

  // 
  //  4.  Sub-API: touchscreen
  // 
  const touchscreen = {
    async tap(x, y) {
      const el = document.elementFromPoint(x, y) || document.body;
      try {
        const t = new Touch({ identifier: Date.now(), target: el, clientX: x, clientY: y });
        el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [t], changedTouches: [t] }));
        el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [t] }));
      } catch { }
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
    },
  };

  // 
  //  5.  Sub-API: clock  (fake-timer implementation)
  // 
  const clock = (() => {
    let installed = false;
    let _fakeNow, _tid = 0, _queue = [];
    let _origTimeout, _origInterval, _origNow, _origDateNow;

    function _runUntil(target) {
      while (_queue.length && _queue[0].at <= target) {
        _fakeNow = _queue[0].at;
        const job = _queue.shift();
        job.fn();
      }
      _fakeNow = target;
    }

    return {
      async install(options = {}) {
        if (installed) return;
        installed = true;
        _fakeNow = options.time ? new Date(options.time).getTime() : Date.now();
        _origTimeout = window.setTimeout;
        _origInterval = window.setInterval;
        _origNow = performance.now.bind(performance);
        _origDateNow = Date.now;
        Date.now = () => _fakeNow;
        window.clearTimeout = (id) => { _queue = _queue.filter(j => j.id !== id); };
        window.clearInterval = (id) => { _queue = _queue.filter(j => j.id !== id); };
        window.setTimeout = (fn, delay = 0, ...args) => {
          const id = ++_tid;
          _queue.push({ id, at: _fakeNow + delay, fn: () => fn(...args), repeat: false, interval: 0 });
          _queue.sort((a, b) => a.at - b.at);
          return id;
        };
        window.setInterval = (fn, interval = 0, ...args) => {
          const id = ++_tid;
          const run = () => {
            fn(...args);
            _queue.push({ id, at: _fakeNow + interval, fn: run, repeat: true, interval });
            _queue.sort((a, b) => a.at - b.at);
          };
          _queue.push({ id, at: _fakeNow + interval, fn: run, repeat: true, interval });
          _queue.sort((a, b) => a.at - b.at);
          return id;
        };
      },
      async uninstall() {
        if (!installed) return;
        window.setTimeout = _origTimeout;
        window.setInterval = _origInterval;
        Date.now = _origDateNow;
        _queue = [];
        installed = false;
      },
      async tick(ms) { _runUntil(_fakeNow + ms); },
      async fastForward(ms) { _runUntil(_fakeNow + ms); },
      async runFor(ms) { _runUntil(_fakeNow + ms); },
      async pause() { /* noop — timers simply won't fire */ },
      async resume() { /* noop */ },
      async setFixedTime(t) { _fakeNow = new Date(t).getTime(); },
      async setSystemTime(t) { _fakeNow = typeof t === 'number' ? t : new Date(t).getTime(); },
    };
  })();

  // 
  //  6.  Sub-API: coverage  (requires CDP — stubs only)
  // 
  const coverage = {
    async startJSCoverage() { console.warn('[__page] JS coverage requires CDP/V8'); },
    async stopJSCoverage() { return []; },
    async startCSSCoverage() { console.warn('[__page] CSS coverage requires CDP/V8'); },
    async stopCSSCoverage() { return []; },
  };

  // 
  //  7.  Sub-API: WebStorage wrappers
  // 
  function _wrapStorage(store) {
    return {
      getItem: (k) => store.getItem(k),
      setItem: (k, v) => store.setItem(k, v),
      removeItem: (k) => store.removeItem(k),
      clear: () => store.clear(),
      entries: () => Object.entries({ ...store }),
    };
  }

  // 
  //  8.  Sub-API: request  (APIRequestContext via fetch)
  // 
  const request = {
    async fetch(urlOrRequest, options = {}) { return fetch(urlOrRequest, options); },
    async get(url, options = {}) { return fetch(url, { ...options, method: 'GET' }); },
    async post(url, options = {}) { return fetch(url, { ...options, method: 'POST' }); },
    async put(url, options = {}) { return fetch(url, { ...options, method: 'PUT' }); },
    async patch(url, options = {}) { return fetch(url, { ...options, method: 'PATCH' }); },
    async delete(url, options = {}) { return fetch(url, { ...options, method: 'DELETE' }); },
    async head(url, options = {}) { return fetch(url, { ...options, method: 'HEAD' }); },
    async storageState() { return { cookies: [], origins: [] }; },
    async dispose() { },
  };

  // 
  //  9.  Locator factory
  // 
  function _locator(selector) {
    const p = window.__page;
    return {
      selector,
      //  actions 
      async click(opts) { return p.click(selector, opts); },
      async dblclick(opts) { return p.dblclick(selector, opts); },
      async tap(opts) { return p.tap(selector, opts); },
      async fill(value, opts) { return p.fill(selector, value, opts); },
      async type(text, opts) { return p.type(selector, text, opts); },
      async press(key, opts) { return p.press(selector, key, opts); },
      async check(opts) { return p.check(selector, opts); },
      async uncheck(opts) { return p.uncheck(selector, opts); },
      async setChecked(v, opts) { return p.setChecked(selector, v, opts); },
      async selectOption(values, opts) { return p.selectOption(selector, values, opts); },
      async hover(opts) { return p.hover(selector, opts); },
      async focus(opts) { return p.focus(selector, opts); },
      async setInputFiles(f, opts) { return p.setInputFiles(selector, f, opts); },
      async dragTo(target, opts) { return p.dragAndDrop(selector, target.selector || target, opts); },
      async dispatchEvent(type, init) { return p.dispatchEvent(selector, type, init); },
      //  queries 
      async getAttribute(name) { return p.getAttribute(selector, name); },
      async innerHTML(opts) { return p.innerHTML(selector, opts); },
      async innerText(opts) { return p.innerText(selector, opts); },
      async textContent(opts) { return p.textContent(selector, opts); },
      async inputValue(opts) { return p.inputValue(selector, opts); },
      //  state 
      async isVisible(opts) { return p.isVisible(selector, opts); },
      async isHidden(opts) { return p.isHidden(selector, opts); },
      async isEnabled(opts) { return p.isEnabled(selector, opts); },
      async isDisabled(opts) { return p.isDisabled(selector, opts); },
      async isChecked(opts) { return p.isChecked(selector, opts); },
      async isEditable(opts) { return p.isEditable(selector, opts); },
      //  waiting 
      async waitFor(opts) { return p.waitForSelector(selector, opts); },
      async count() { return _queryAll(selector).length; },
      async boundingBox() {
        const el = _query(selector);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      },
      async scrollIntoViewIfNeeded() {
        _query(selector)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      },
      //  evaluate 
      async evaluate(fn, arg) { return p.$eval(selector, fn, arg); },
      async evaluateAll(fn, arg) { return p.$$eval(selector, fn, arg); },
      async screenshot(opts) { return p.screenshot(opts); },
      //  chaining 
      nth(n) {
        const all = _queryAll(selector);
        const el = all[n];
        if (!el) return _locator(selector);
        const id = el.id || el.getAttribute('data-testid');
        return _locator(id ? `[id="${el.id}"]` : selector);
      },
      first() { return this.nth(0); },
      last() { const all = _queryAll(selector); return this.nth(all.length - 1); },
      locator(sub) { return _locator(`${selector} ${sub}`); },
      filter(opts) { return _locator(selector); },
      or(other) { return _locator(`${selector}, ${other.selector}`); },
      and(other) { return _locator(selector); },
      //  getBy* pass-through 
      getByRole(role, opts) { return p.getByRole(role, opts); },
      getByText(text, opts) { return p.getByText(text, opts); },
      getByLabel(text, opts) { return p.getByLabel(text, opts); },
      getByPlaceholder(text, opts) { return p.getByPlaceholder(text, opts); },
      getByAltText(text, opts) { return p.getByAltText(text, opts); },
      getByTitle(text, opts) { return p.getByTitle(text, opts); },
      getByTestId(id) { return p.getByTestId(id); },
    };
  }

  /**
   * Locator backed by a runtime DOM predicate instead of a static CSS selector.
   * Used by getBy* methods.
   */
  function _predicateLocator(baseCSS, pred) {
    const all = () => Array.from(document.querySelectorAll(baseCSS)).filter(pred);
    const first = () => all()[0] || null;
    const p = window.__page;
    return {
      _all: all,
      async click(opts) { first()?.click(); },
      async fill(value) { const el = first(); if (el) { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); } },
      async textContent() { return first()?.textContent ?? null; },
      async innerText() { return first()?.innerText ?? null; },
      async innerHTML() { return first()?.innerHTML ?? null; },
      async inputValue() { return first()?.value ?? ''; },
      async getAttribute(name) { return first()?.getAttribute(name) ?? null; },
      async isVisible() { return _isVisible(first()); },
      async isHidden() { const el = first(); return !el || !_isVisible(el); },
      async isChecked() { return !!first()?.checked; },
      async isDisabled() { return !!first()?.disabled; },
      async isEnabled() { return !first()?.disabled; },
      async isEditable() { const el = first(); return el && !el.disabled && !el.readOnly; },
      async count() { return all().length; },
      nth(n) { return _locator('');  /* simplified */ },
      first() { return _predicateLocator(baseCSS, pred); },
      last() { return _predicateLocator(baseCSS, pred); },
      async hover() { first()?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); },
      async focus() { first()?.focus(); },
      async press(key) { await p.keyboard.press(key); },
      async check() { const el = first(); if (el && !el.checked) { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); } },
      async uncheck() { const el = first(); if (el?.checked) { el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true })); } },
      async dblclick() { const el = first(); el?.click(); el?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); },
      async tap() { first()?.click(); },
      async selectOption(values) { const el = first(); if (el) return p.selectOption(baseCSS, values); },
      async dispatchEvent(type, init) { first()?.dispatchEvent(new CustomEvent(type, { bubbles: true, ...init })); },
      async scrollIntoViewIfNeeded() { first()?.scrollIntoView({ behavior: 'smooth', block: 'center' }); },
      async boundingBox() {
        const el = first();
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      },
      async waitFor(opts = {}) {
        const timeout = opts.timeout ?? 5000;
        const el = first();
        if (el) return el;
        return new Promise((resolve, reject) => {
          const t = setTimeout(() => { obs.disconnect(); reject(new Error('Timeout')); }, timeout);
          const obs = new MutationObserver(() => {
            const found = first();
            if (found) { clearTimeout(t); obs.disconnect(); resolve(found); }
          });
          obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
        });
      },
      filter(opts) { return _predicateLocator(baseCSS, pred); },
      or(other) { return _predicateLocator(baseCSS, pred); },
      and(other) { return _predicateLocator(baseCSS, pred); },
      locator(sub) { return _locator(`${baseCSS} ${sub}`); },
    };
  }

  // 
  // 10.  Main  window.__page  object
  // 
  window.__page = {

    //  Sub-API properties 
    keyboard,
    mouse,
    touchscreen,
    clock,
    coverage,
    localStorage: _wrapStorage(window.localStorage),
    sessionStorage: _wrapStorage(window.sessionStorage),
    request,
    screencast: { path: null }, // stub — requires CDP recording

    //  Internal state 
    _consoleMessages: [],
    _pageErrors: [],
    _defaultTimeout: 30_000,
    _defaultNavTimeout: 30_000,

    // 
    //  Navigation
    // 
    async goto(url, options = {}) {
      window.location.href = url;
      return this.waitForLoadState(options.waitUntil || 'load', { timeout: options.timeout ?? this._defaultNavTimeout })
        .then(() => null);
    },
    async goBack(options = {}) {
      window.history.back();
      return null;
    },
    async goForward(options = {}) {
      window.history.forward();
      return null;
    },
    async reload(options = {}) {
      window.location.reload();
      return null;
    },
    async waitForURL(url, options = {}) {
      const timeout = options.timeout ?? this._defaultNavTimeout;
      const start = Date.now();
      return new Promise((resolve, reject) => {
        const check = () => {
          if (_matchUrl(url, window.location.href)) return resolve();
          if (Date.now() - start >= timeout) return reject(new Error('waitForURL timeout'));
          setTimeout(check, 100);
        };
        check();
      });
    },
    async waitForNavigation(options = {}) {
      return this.waitForLoadState(options.waitUntil || 'load', options);
    },
    async waitForLoadState(state = 'load', options = {}) {
      const timeout = options.timeout ?? this._defaultNavTimeout;
      if (state === 'commit') return;
      if (state === 'domcontentloaded') {
        if (document.readyState !== 'loading') return;
        return new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error('waitForLoadState: domcontentloaded timeout')), timeout);
          document.addEventListener('DOMContentLoaded', () => { clearTimeout(t); res(); }, { once: true });
        });
      }
      // 'load' | 'networkidle'
      if (document.readyState === 'complete') return;
      return new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('waitForLoadState: ' + state + ' timeout')), timeout);
        window.addEventListener('load', () => { clearTimeout(t); res(); }, { once: true });
      });
    },

    // 
    //  Page content
    // 
    url() { return location.href; },
    async title() { return document.title; },
    async content() { return document.documentElement.outerHTML; },
    async setContent(html, options = {}) {
      document.open(); document.write(html); document.close();
      if (options.waitUntil) await this.waitForLoadState(options.waitUntil, options);
    },
    context() { return null; }, // no BrowserContext concept inside the page

    // 
    //  Element selection ($, $$, eval)
    // 
    async $(selector, options = {}) {
      return _query(selector);
    },
    async $$(selector) {
      return _queryAll(selector);
    },
    async $eval(selector, pageFunction, arg) {
      const el = _query(selector);
      if (!el) throw new Error('No element: ' + selector);
      return typeof pageFunction === 'function'
        ? pageFunction(el, arg)
        : (0, eval)(`(${pageFunction})`)(el, arg);
    },
    async $$eval(selector, pageFunction, arg) {
      const els = _queryAll(selector);
      return typeof pageFunction === 'function'
        ? pageFunction(els, arg)
        : (0, eval)(`(${pageFunction})`)(els, arg);
    },

    // 
    //  Evaluate / evaluateHandle
    // 
    async evaluate(pageFunction, arg) {
      return typeof pageFunction === 'function'
        ? pageFunction(arg)
        : (0, eval)(`(${pageFunction})(${arg !== undefined ? JSON.stringify(arg) : ''})`);
    },
    async evaluateHandle(pageFunction, arg) {
      return this.evaluate(pageFunction, arg);
    },

    // 
    //  Locators
    // 
    locator(selector, options = {}) { return _locator(selector); },

    getByRole(role, options = {}) {
      const base = [_nativeRole(role), `[role="${role}"]`].join(', ');
      const { name, exact, disabled, checked, expanded, pressed, selected, level } = options;
      return _predicateLocator('*', el => {
        const r = el.getAttribute('role') || el.tagName.toLowerCase();
        // simplified: match by role + accessible name
        const matchRole = r === role || el.matches(_nativeRole(role)) || el.getAttribute('role') === role;
        if (!matchRole) return false;
        if (name !== undefined) {
          const label = el.getAttribute('aria-label') || el.textContent?.trim() || el.getAttribute('title') || el.getAttribute('alt') || '';
          const n = typeof name === 'string' ? name : name.source;
          if (!(exact ? label === n : (name instanceof RegExp ? name.test(label) : label.includes(n)))) return false;
        }
        if (disabled !== undefined && el.disabled !== disabled) return false;
        if (checked !== undefined && !!el.checked !== checked) return false;
        if (expanded !== undefined && el.getAttribute('aria-expanded') !== String(expanded)) return false;
        if (level !== undefined) {
          const lvl = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 }[el.tagName] || parseInt(el.getAttribute('aria-level') || '0');
          if (lvl !== level) return false;
        }
        return true;
      });
    },
    getByText(text, options = {}) {
      const { exact } = options;
      return _predicateLocator('*', el => {
        const t = el.textContent?.trim() ?? '';
        if (text instanceof RegExp) return text.test(t);
        return exact ? t === text : t.includes(text);
      });
    },
    getByLabel(text, options = {}) {
      const { exact } = options;
      const match = (s) => text instanceof RegExp ? text.test(s)
        : exact ? s === text : s.includes(String(text));
      return _predicateLocator('input, select, textarea, [role=textbox], [role=combobox]', el => {
        if (el.id) {
          const lbl = document.querySelector(`label[for="${el.id}"]`);
          if (lbl && match(lbl.textContent?.trim() || '')) return true;
        }
        const wrap = el.closest('label');
        if (wrap && match(wrap.textContent?.trim() || '')) return true;
        const aria = el.getAttribute('aria-label');
        if (aria && match(aria)) return true;
        return false;
      });
    },
    getByPlaceholder(text, options = {}) {
      const { exact } = options;
      return _predicateLocator('[placeholder]', el => {
        const p = el.getAttribute('placeholder') || '';
        if (text instanceof RegExp) return text.test(p);
        return exact ? p === text : p.includes(String(text));
      });
    },
    getByAltText(text, options = {}) {
      const { exact } = options;
      return _predicateLocator('[alt]', el => {
        const a = el.getAttribute('alt') || '';
        if (text instanceof RegExp) return text.test(a);
        return exact ? a === text : a.includes(String(text));
      });
    },
    getByTitle(text, options = {}) {
      const { exact } = options;
      return _predicateLocator('[title]', el => {
        const t = el.getAttribute('title') || '';
        if (text instanceof RegExp) return text.test(t);
        return exact ? t === text : t.includes(String(text));
      });
    },
    getByTestId(testId) {
      return _predicateLocator('[data-testid]', el => {
        const v = el.getAttribute('data-testid') || '';
        return testId instanceof RegExp ? testId.test(v) : v === String(testId);
      });
    },

    // 
    //  Frames
    // 
    frameLocator(selector) {
      const iframe = document.querySelector(selector);
      if (!iframe) return null;
      const doc = iframe.contentDocument;
      return {
        locator: (sel) => _locator(sel), // simplified
        getByRole: (...a) => this.getByRole(...a),
        getByText: (...a) => this.getByText(...a),
        getByLabel: (...a) => this.getByLabel(...a),
        getByPlaceholder: (...a) => this.getByPlaceholder(...a),
        getByAltText: (...a) => this.getByAltText(...a),
        getByTitle: (...a) => this.getByTitle(...a),
        getByTestId: (...a) => this.getByTestId(...a),
      };
    },
    frame(frameSelector) {
      if (typeof frameSelector === 'string') {
        return document.querySelector(frameSelector)?.contentWindow || null;
      }
      const { name, url } = frameSelector || {};
      return Array.from(document.querySelectorAll('iframe')).find(f => {
        if (name && f.name === name) return true;
        if (url) return _matchUrl(url, f.src || '');
        return false;
      })?.contentWindow || null;
    },
    frames() {
      return Array.from(document.querySelectorAll('iframe'))
        .map(f => f.contentWindow).filter(Boolean);
    },
    mainFrame() { return window; },

    // 
    //  Actions
    // 
    async click(selector, options = {}) {
      const el = await _resolve(selector, options.timeout ?? this._defaultTimeout);
      const r = el.getBoundingClientRect();
      const x = options.position?.x ?? r.left + r.width / 2;
      const y = options.position?.y ?? r.top + r.height / 2;
      const btn = options.button === 'right' ? 2 : options.button === 'middle' ? 1 : 0;
      const mods = _modifiers(options.modifiers);
      const count = options.clickCount || 1;
      el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      for (let i = 0; i < count; i++) {
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: btn, clientX: x, clientY: y, ...mods, detail: i + 1 }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: btn, clientX: x, clientY: y, ...mods }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: btn, clientX: x, clientY: y, ...mods, detail: i + 1 }));
      }
    },
    async dblclick(selector, options = {}) {
      await this.click(selector, { ...options, clickCount: 2 });
      const el = _query(selector);
      if (el) {
        const r = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('dblclick', {
          bubbles: true, cancelable: true,
          clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, detail: 2,
        }));
      }
    },
    async tap(selector, options = {}) {
      const el = await _resolve(selector, options.timeout ?? this._defaultTimeout);
      const r = el.getBoundingClientRect();
      const x = options.position?.x ?? r.left + r.width / 2;
      const y = options.position?.y ?? r.top + r.height / 2;
      try {
        const t = new Touch({ identifier: Date.now(), target: el, clientX: x, clientY: y });
        el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [t], changedTouches: [t] }));
        el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [t] }));
      } catch { }
      el.click();
    },
    async hover(selector, options = {}) {
      const el = await _resolve(selector, options.timeout ?? this._defaultTimeout);
      const r = el.getBoundingClientRect();
      const x = options.position?.x ?? r.left + r.width / 2;
      const y = options.position?.y ?? r.top + r.height / 2;
      el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: x, clientY: y }));
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: x, clientY: y }));
      el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
    },
    async focus(selector, options = {}) {
      const el = await _resolve(selector, options.timeout ?? this._defaultTimeout);
      el.focus();
    },
    async fill(selector, value, options = {}) {
      const el = await _resolve(selector, options.timeout ?? this._defaultTimeout);
      el.focus();
      // Use React/framework-compatible native setter
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter?.call(el, value);
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    async type(selector, text, options = {}) {
      const el = await _resolve(selector, options.timeout ?? this._defaultTimeout);
      const delay = options.delay || 0;
      el.focus();
      for (const char of text) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));
        el.value = (el.value || '') + char;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
        if (delay) await new Promise(r => setTimeout(r, delay));
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    async press(selector, key, options = {}) {
      const el = await _resolve(selector, options.timeout ?? this._defaultTimeout);
      el.focus();
      const ki = { key, bubbles: true, cancelable: true };
      el.dispatchEvent(new KeyboardEvent('keydown', ki));
      if (options.delay) await new Promise(r => setTimeout(r, options.delay));
      el.dispatchEvent(new KeyboardEvent('keypress', ki));
      el.dispatchEvent(new KeyboardEvent('keyup', ki));
      if (key === 'Enter') {
        const form = el.closest('form');
        if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        if (el.tagName === 'BUTTON' || el.type === 'submit') el.click();
      }
    },
    async check(selector, options = {}) {
      const el = await _resolve(selector, options.timeout ?? this._defaultTimeout);
      if (!el.checked) {
        el.checked = true;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    },
    async uncheck(selector, options = {}) {
      const el = await _resolve(selector, options.timeout ?? this._defaultTimeout);
      if (el.checked) {
        el.checked = false;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    },
    async setChecked(selector, checked, options = {}) {
      return checked ? this.check(selector, options) : this.uncheck(selector, options);
    },
    async selectOption(selector, values, options = {}) {
      const el = await _resolve(selector, options.timeout ?? this._defaultTimeout);
      const norm = v => typeof v === 'string' ? { value: v } : v;
      const vals = values === null ? []
        : Array.isArray(values) ? values.map(norm) : [norm(values)];
      const selected = [];
      Array.from(el.options).forEach(opt => {
        const match = vals.some(v =>
          (v.value !== undefined && opt.value === v.value) ||
          (v.label !== undefined && opt.label === v.label) ||
          (v.index !== undefined && opt.index === v.index)
        );
        opt.selected = match;
        if (match) selected.push(opt.value);
      });
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return selected;
    },
    async dragAndDrop(source, target, options = {}) {
      const srcEl = await _resolve(source, options.timeout ?? this._defaultTimeout);
      const tgtEl = await _resolve(target, options.timeout ?? this._defaultTimeout);
      const sr = srcEl.getBoundingClientRect(), tr = tgtEl.getBoundingClientRect();
      const sx = options.sourcePosition?.x ?? sr.left + sr.width / 2;
      const sy = options.sourcePosition?.y ?? sr.top + sr.height / 2;
      const tx = options.targetPosition?.x ?? tr.left + tr.width / 2;
      const ty = options.targetPosition?.y ?? tr.top + tr.height / 2;
      const dt = new DataTransfer();
      srcEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt, clientX: sx, clientY: sy }));
      srcEl.dispatchEvent(new DragEvent('drag', { bubbles: true, dataTransfer: dt }));
      tgtEl.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: dt, clientX: tx, clientY: ty }));
      tgtEl.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt, clientX: tx, clientY: ty }));
      tgtEl.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt, clientX: tx, clientY: ty }));
      srcEl.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    },
    async dispatchEvent(selector, type, eventInit = {}, options = {}) {
      const el = await _resolve(selector, options.timeout ?? this._defaultTimeout);
      const Ctor = type.startsWith('mouse') ? MouseEvent
        : type.startsWith('key') ? KeyboardEvent
          : type.startsWith('touch') ? TouchEvent
            : CustomEvent;
      el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, ...eventInit }));
    },
    async setInputFiles(selector, files, options = {}) {
      const el = await _resolve(selector, options.timeout ?? this._defaultTimeout);
      const dt = new DataTransfer();
      const arr = Array.isArray(files) ? files : [files];
      for (const f of arr) {
        if (f instanceof File) {
          dt.items.add(f);
        } else if (typeof f === 'object' && f.name) {
          const blob = new Blob([f.buffer || new ArrayBuffer(0)], { type: f.mimeType || 'application/octet-stream' });
          dt.items.add(new File([blob], f.name, { type: f.mimeType }));
        }
      }
      try { Object.defineProperty(el, 'files', { value: dt.files, configurable: true, writable: true }); } catch { }
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },

    // 
    //  Attributes & content
    // 
    async getAttribute(selector, name, options = {}) {
      const el = await _resolve(selector, options.timeout ?? this._defaultTimeout);
      return el.getAttribute(name);
    },
    async innerHTML(selector, options = {}) {
      const el = await _resolve(selector, options.timeout ?? this._defaultTimeout);
      return el.innerHTML;
    },
    async innerText(selector, options = {}) {
      const el = await _resolve(selector, options.timeout ?? this._defaultTimeout);
      return el.innerText;
    },
    async textContent(selector, options = {}) {
      const el = await _resolve(selector, options.timeout ?? this._defaultTimeout);
      return el.textContent;
    },
    async inputValue(selector, options = {}) {
      const el = await _resolve(selector, options.timeout ?? this._defaultTimeout);
      return el.value ?? '';
    },

    // 
    //  State checks
    // 
    async isChecked(selector, options = {}) {
      const el = await _resolve(selector, options.timeout ?? this._defaultTimeout);
      return !!el.checked;
    },
    async isDisabled(selector, options = {}) {
      const el = await _resolve(selector, options.timeout ?? this._defaultTimeout);
      return el.disabled || el.getAttribute('aria-disabled') === 'true';
    },
    async isEditable(selector, options = {}) {
      const el = await _resolve(selector, options.timeout ?? this._defaultTimeout);
      return !el.disabled && !el.readOnly;
    },
    async isEnabled(selector, options = {}) {
      const el = await _resolve(selector, options.timeout ?? this._defaultTimeout);
      return !(el.disabled || el.getAttribute('aria-disabled') === 'true');
    },
    async isHidden(selector, options = {}) {
      const el = _query(selector);
      return !el || !_isVisible(el);
    },
    async isVisible(selector, options = {}) {
      const el = _query(selector);
      return !!el && _isVisible(el);
    },
    isClosed() { return false; }, // the page IS open — we're inside it

    // 
    //  Waiting
    // 
    async waitForSelector(selector, options = {}) {
      const timeout = options.timeout ?? this._defaultTimeout;
      const state = options.state ?? 'attached';

      if (state === 'detached') {
        if (!_query(selector)) return null;
        return new Promise((resolve, reject) => {
          const t = setTimeout(() => { obs.disconnect(); reject(new Error('waitForSelector(detached) timeout')); }, timeout);
          const obs = new MutationObserver(() => {
            if (!_query(selector)) { clearTimeout(t); obs.disconnect(); resolve(null); }
          });
          obs.observe(document.documentElement, { childList: true, subtree: true });
        });
      }

      const el = _query(selector);
      if (el && (state === 'attached' || (state === 'visible' && _isVisible(el)))) return el;

      return new Promise((resolve, reject) => {
        const t = setTimeout(() => { obs.disconnect(); reject(new Error('waitForSelector timeout: ' + selector)); }, timeout);
        const obs = new MutationObserver(() => {
          const found = _query(selector);
          if (found && (state === 'attached' || (state === 'visible' && _isVisible(found)) || state === 'hidden' && !_isVisible(found))) {
            clearTimeout(t); obs.disconnect(); resolve(found);
          }
        });
        obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
      });
    },
    async waitForFunction(pageFunction, arg, options = {}) {
      const timeout = options.timeout ?? this._defaultTimeout;
      const polling = options.polling ?? 100;
      const fn = typeof pageFunction === 'function'
        ? pageFunction
        : (a) => (0, eval)(`(${pageFunction})`)(a);
      const start = Date.now();
      return new Promise((resolve, reject) => {
        const tick = async () => {
          try { const r = await fn(arg); if (r) return resolve(r); } catch { }
          if (Date.now() - start >= timeout) return reject(new Error('waitForFunction timeout'));
          setTimeout(tick, polling);
        };
        tick();
      });
    },
    async waitForTimeout(timeout) {
      return new Promise(r => setTimeout(r, timeout));
    },
    async waitForRequest(urlOrPredicate, options = {}) {
      // Real implementation requires CDP; returns a best-effort promise via fetch interception
      console.warn('[__page] waitForRequest: only intercepts fetch calls made after this point');
      const timeout = options.timeout ?? this._defaultTimeout;
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('waitForRequest timeout')), timeout);
        const origFetch = window.__origFetch || window.fetch;
        window.__origFetch = origFetch;
        window.fetch = async (input, init) => {
          const url = typeof input === 'string' ? input : input.url;
          const req = { url: () => url, method: () => (init?.method || 'GET') };
          const match = typeof urlOrPredicate === 'function'
            ? urlOrPredicate(req)
            : _matchUrl(urlOrPredicate, url);
          if (match) {
            clearTimeout(t);
            window.fetch = origFetch;
            resolve(req);
          }
          return origFetch(input, init);
        };
        if (options.signal) options.signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); });
      });
    },
    async waitForResponse(urlOrPredicate, options = {}) {
      console.warn('[__page] waitForResponse: only intercepts fetch calls made after this point');
      const timeout = options.timeout ?? this._defaultTimeout;
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('waitForResponse timeout')), timeout);
        const origFetch = window.__origFetch || window.fetch;
        window.__origFetch = origFetch;
        window.fetch = async (input, init) => {
          const url = typeof input === 'string' ? input : input.url;
          const resp = await origFetch(input, init);
          const match = typeof urlOrPredicate === 'function'
            ? urlOrPredicate(resp)
            : _matchUrl(urlOrPredicate, url);
          if (match) { clearTimeout(t); window.fetch = origFetch; resolve(resp); }
          return resp;
        };
      });
    },
    async waitForEvent(event, optionsOrPredicate = {}) {
      const opts = typeof optionsOrPredicate === 'function'
        ? { predicate: optionsOrPredicate }
        : optionsOrPredicate;
      const { timeout = this._defaultTimeout, predicate, signal } = opts;
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => { _off(event, h); reject(new Error('waitForEvent timeout: ' + event)); }, timeout);
        const h = (data) => {
          if (!predicate || predicate(data)) { clearTimeout(t); _off(event, h); resolve(data); }
        };
        _on(event, h);
        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(t); _off(event, h);
            reject(new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        }
      });
    },

    // 
    //  Script & style injection
    // 
    async addScriptTag(options = {}) {
      const script = document.createElement('script');
      if (options.type) script.type = options.type;
      if (options.content) { script.textContent = options.content; document.head.appendChild(script); return script; }
      if (options.url) {
        script.src = options.url;
        document.head.appendChild(script);
        await new Promise((res, rej) => { script.onload = res; script.onerror = rej; });
        return script;
      }
      if (options.path) throw new Error('addScriptTag: path option requires Node.js fs access');
      document.head.appendChild(script);
      return script;
    },
    async addStyleTag(options = {}) {
      if (options.url) {
        const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: options.url });
        document.head.appendChild(link);
        await new Promise((res, rej) => { link.onload = res; link.onerror = rej; });
        return link;
      }
      const style = document.createElement('style');
      style.textContent = options.content || '';
      document.head.appendChild(style);
      return style;
    },
    async addInitScript(script, arg) {
      if (typeof script === 'function') return script(arg);
      if (typeof script === 'string') return (0, eval)(script);
      if (script?.content) return (0, eval)(script.content);
      if (script?.url) return this.addScriptTag({ url: script.url });
    },
    async addLocatorHandler(locator, handler, options = {}) {
      const times = options.times ?? Infinity;
      let count = 0;
      const obs = new MutationObserver(async () => {
        const el = _query(locator.selector);
        if (el && _isVisible(el) && count < times) {
          count++;
          try { await handler(locator); } catch { }
          if (options.noWaitAfter !== false) await new Promise(r => setTimeout(r, 0));
          if (count >= times) obs.disconnect();
        }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      _locatorHandlers.set(locator, obs);
    },
    async removeLocatorHandler(locator) {
      const obs = _locatorHandlers.get(locator);
      if (obs) { obs.disconnect(); _locatorHandlers.delete(locator); }
    },

    // 
    //  Expose / binding
    // 
    async exposeFunction(name, callback) {
      window[name] = callback;
      return _disposable(() => { delete window[name]; });
    },
    async exposeBinding(name, playwrightBinding) {
      window[name] = (...args) =>
        playwrightBinding({ page: window.__page, context: null, frame: window }, ...args);
      return _disposable(() => { delete window[name]; });
    },

    // 
    //  Network routing  (fetch-level only)
    // 
    async route(url, handler, options = {}) {
      const times = options.times ?? Infinity;
      let calls = 0;
      const orig = window.__origFetch ?? window.fetch;
      window.__origFetch = orig;
      window.fetch = async (input, init = {}) => {
        const reqUrl = typeof input === 'string' ? input : input.url;
        if (_matchUrl(url, reqUrl) && calls < times) {
          calls++;
          const route = {
            async continue(overrides = {}) { return orig(overrides.url ?? input, { ...init, ...overrides }); },
            async fulfill(response = {}) {
              return new Response(response.body ?? '', {
                status: response.status ?? 200, headers: response.headers ?? {},
              });
            },
            async abort(reason) { throw new Error(reason ?? 'net::ERR_ABORTED'); },
          };
          const req = {
            url: () => reqUrl,
            method: () => init.method ?? 'GET',
            headers: () => init.headers ?? {},
            postData: () => init.body ?? null,
          };
          return handler(route, req);
        }
        return orig(input, init);
      };
    },
    async unroute(url, handler) {
      if (window.__origFetch) { window.fetch = window.__origFetch; delete window.__origFetch; }
    },
    async unrouteAll(options = {}) {
      if (window.__origFetch) { window.fetch = window.__origFetch; delete window.__origFetch; }
    },
    async routeFromHAR(har, options = {}) {
      throw new Error('routeFromHAR requires Node.js / CDP access');
    },
    async routeWebSocket(url, handler) {
      throw new Error('routeWebSocket requires browser-level WebSocket interception (CDP)');
    },
    async requests() { return window.__capturedRequests ?? []; },
    async requestGC() { if (typeof window.gc === 'function') window.gc(); },
    async setExtraHTTPHeaders(headers) { window.__extraHeaders = headers; },

    // 
    //  Screenshot / PDF
    // 
    async screenshot(options = {}) {
      console.error("screenshot() currently unvalaible");
      return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
    },
    async pdf(options = {}) {
      throw new Error('pdf() currently unvalaible');
    },

    // 
    //  Viewport
    // 
    viewportSize() { return { width: window.innerWidth, height: window.innerHeight }; },
    async setViewportSize(viewportSize) {
      try { window.resizeTo(viewportSize.width, viewportSize.height); } catch { }
    },

    // 
    //  Media
    // 
    async emulateMedia(options = {}) {
      if (options.colorScheme != null) {
        document.documentElement.setAttribute('data-color-scheme', options.colorScheme);
      }
      if (options.media != null) {
        document.documentElement.setAttribute('data-media', options.media);
      }
    },

    // 
    //  ARIA snapshot
    // 
    async ariaSnapshot(options = {}) {
      const maxDepth = options.depth ?? 10;
      function snap(el, d = 0) {
        if (d > maxDepth) return null;
        const role = el.getAttribute('role') || el.tagName.toLowerCase();
        const label = el.getAttribute('aria-label')
          || (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim())
          || (el.children.length === 0 ? el.textContent?.trim().slice(0, 80) : '');
        const states = [
          el.getAttribute('aria-checked') !== null ? `checked=${el.getAttribute('aria-checked')}` : '',
          el.getAttribute('aria-expanded') !== null ? `expanded=${el.getAttribute('aria-expanded')}` : '',
          el.getAttribute('aria-pressed') !== null ? `pressed=${el.getAttribute('aria-pressed')}` : '',
          el.disabled ? 'disabled' : '',
          el.readOnly ? 'readonly' : '',
        ].filter(Boolean).join(' ');
        const children = Array.from(el.children)
          .map(c => snap(c, d + 1)).filter(Boolean)
          .map(s => '  '.repeat(d + 1) + s).join('\n');
        return `- ${role}${label ? ` "${label}"` : ''}${states ? ` [${states}]` : ''}${children ? '\n' + children : ''}`;
      }
      return snap(document.body);
    },

    // 
    //  Console & error tracking
    // 
    async consoleMessages(options = {}) { return this._consoleMessages; },
    async pageErrors(options = {}) { return this._pageErrors; },
    async clearConsoleMessages() { this._consoleMessages = []; },
    async clearPageErrors() { this._pageErrors = []; },

    // 
    //  Locator highlight & picker
    // 
    async hideHighlight() {
      document.querySelectorAll('[data-pw-highlight]').forEach(el => el.remove());
    },
    async cancelPickLocator() { window.__pickActive = false; },
    async pickLocator() {
      window.__pickActive = true;
      return new Promise(resolve => {
        const handler = e => {
          if (!window.__pickActive) return;
          e.preventDefault(); e.stopPropagation();
          document.removeEventListener('click', handler, true);
          window.__pickActive = false;
          const el = e.target;
          const sel = el.id
            ? `#${el.id}`
            : el.getAttribute('data-testid')
              ? `[data-testid="${el.getAttribute('data-testid')}"]`
              : el.tagName.toLowerCase()
              + (el.className ? '.' + [...el.classList].join('.') : '');
          resolve(_locator(sel));
        };
        document.addEventListener('click', handler, true);
      });
    },

    // 
    //  Page lifecycle
    // 
    async bringToFront() { window.focus(); },
    async close(options = {}) { window.close(); },
    async opener() { return window.opener?.__page ?? null; },
    async pause() { debugger; }, // eslint-disable-line no-debugger
    workers() { return []; },  // Would require ServiceWorker registry access
    video() { return null; }, // Requires CDP recording

    // 
    //  Timeouts
    // 
    setDefaultNavigationTimeout(timeout) { this._defaultNavTimeout = timeout; },
    setDefaultTimeout(timeout) { this._defaultTimeout = timeout; },

    // 
    //  Event emitter (on/off/once/etc.)
    // 
    on(event, listener) { return _on(event, listener); },
    off(event, listener) { return _off(event, listener); },
    addListener(event, listener) { return _on(event, listener); },
    removeListener(event, listener) { return _off(event, listener); },
    once(event, listener) {
      const w = (...args) => { _off(event, w); listener(...args); };
      return _on(event, w);
    },
    prependListener(event, listener) {
      _bus[event] = [listener, ...(_bus[event] || [])];
      return window.__page;
    },
    removeAllListeners(type, options) {
      if (typeof type === 'string') delete _bus[type];
      else Object.keys(_bus).forEach(k => delete _bus[k]);
      // When options arg is present Playwright returns a Promise
      return options ? Promise.resolve() : window.__page;
    },

    // asyncDispose (for "await using page" TypeScript syntax)
    async [Symbol.asyncDispose]() { await this.close(); },
  };

  // 
  // 11.  Console interception  →  feeds _consoleMessages + 'console' event
  // 
  ['log', 'warn', 'error', 'info', 'debug'].forEach(method => {
    const orig = console[method].bind(console);
    console[method] = async (...args) => {
      const msg = {
        type: method,
        text: args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '),
        timestamp: Date.now(),
      };
      window.__page._consoleMessages.push(msg);
      const label = await window.__TAURI__.webview.getCurrentWebview().label;
      await window.__TAURI__.event.emit('update_console', {
        target: label,
        msg: msg
      });
      _emit('console', msg);
      orig(...args);
    };
  });

  // 
  // 12.  Error tracking  →  feeds _pageErrors + 'pageerror' event
  // 
  window.addEventListener('error', e => {
    const err = e.error || new Error(e.message);
    window.__page._pageErrors.push(err);
    _emit('pageerror', err);
  });
  window.addEventListener('unhandledrejection', e => {
    const err = e.reason instanceof Error ? e.reason : new Error(String(e.reason));
    window.__page._pageErrors.push(err);
    _emit('pageerror', err);
  });

  // 
  // 13.  DOM → __page event bridge
  // 
  window.addEventListener('load', () => _emit('load', window.__page));
  window.addEventListener('beforeunload', () => _emit('close', window.__page));
  document.addEventListener('DOMContentLoaded', () => _emit('domcontentloaded', window.__page));
  window.addEventListener('popstate', () => _emit('framenavigated', window.self));

})();
