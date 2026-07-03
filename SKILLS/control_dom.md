---
name: webagent
description: >
  Playwright Page API polyfill injected into every webview page via injection.js. 
  Use this skill whenever you  need to automate DOM interactions, navigate pages, 
  query elements, manipulate storage, fake timers, or scrape page content.
---

# WebAgent — `window.__page` In-Browser Polyfill

## Overview
`Playwright Page API polyfill` is injected into every webview page and exposes a **`window.__page`** object that mirrors the Playwright `Page` TypeScript interface. It is a **pure DOM/fetch** implementation — no Node.js, no CDP, no browser extension.
---


## Selector System

All methods that accept a `selector` string support:

| Selector form | Resolves to |
|---|---|
| `'#id'`, `'.class'`, `'div > p'` | Native CSS via `document.querySelector` |
| `'text=Submit'` | First element whose `textContent` matches |
| `'label=Email'` | Input associated with a `<label>` by `for` or wrapping |
| `'placeholder=Search'` | `[placeholder="Search"]` |
| `'role=button'` | `[role="button"]` + native HTML fallback |

Resolution uses **MutationObserver fallback** — if the element isn't in the DOM yet, it waits up to `timeout` ms (default **30 000 ms**) for it to appear.

---

## Element Selection

```js
const el  = await window.__page.$('#submit');         // first match or null
const els = await window.__page.$$('li.item');        // all matches

// Evaluate in page context
const text = await window.__page.$eval('h1', el => el.textContent);
const vals  = await window.__page.$$eval('input', els => els.map(e => e.value));

// Generic evaluate
const result = await window.__page.evaluate(() => document.title);
const handle = await window.__page.evaluateHandle(() => document.body);
```

---

## Locators

Preferred, chainable element API:

```js
const btn = window.__page.locator('#submit');
await btn.click();
await btn.fill('hello');
await btn.textContent();
await btn.isVisible();
await btn.waitFor({ state: 'visible', timeout: 5000 });
await btn.scrollIntoViewIfNeeded();

// Chaining
const row = window.__page.locator('table tr').nth(2);
const first = window.__page.locator('li').first();
const last  = window.__page.locator('li').last();
const sub   = window.__page.locator('.card').locator('button');
const combo = locatorA.or(locatorB);                // CSS union
```

### getBy* methods 

```js
window.__page.getByRole('button', { name: 'Submit' });
window.__page.getByRole('heading', { level: 2 });
window.__page.getByText('Sign in');
window.__page.getByText(/welcome/i);
window.__page.getByLabel('Email address');
window.__page.getByPlaceholder('Search...');
window.__page.getByAltText('Company logo');
window.__page.getByTitle('Close dialog');
window.__page.getByTestId('submit-btn');           // matches data-testid attribute
```

All `getBy*` methods return a **predicate-locator** that re-evaluates on every access (live).

---

## Actions

```js
// Click
await window.__page.click('#btn');
await window.__page.click('#btn', { button: 'right', clickCount: 2, modifiers: ['Shift'] });
await window.__page.dblclick('.item');
await window.__page.tap('#mobile-btn');

// Hover / Focus
await window.__page.hover('.menu-item');
await window.__page.focus('input[name=email]');

// Fill / Type
await window.__page.fill('input[name=email]', 'user@example.com');   // sets value directly, React-safe
await window.__page.type('input', 'hello', { delay: 50 });           // char-by-char with events

// Keyboard press on element
await window.__page.press('input', 'Enter');
await window.__page.press('input', 'Tab');

// Checkbox / Select
await window.__page.check('input[type=checkbox]');
await window.__page.uncheck('input[type=checkbox]');
await window.__page.setChecked('input[type=checkbox]', true);
await window.__page.selectOption('select#country', 'US');
await window.__page.selectOption('select', [{ label: 'Canada' }, { index: 2 }]);

// Dispatch custom event
await window.__page.dispatchEvent('#el', 'click');
await window.__page.dispatchEvent('#el', 'custom:event', { detail: { foo: 1 } });
```

---

## Keyboard Sub-API

```js
const kb = window.__page.keyboard;

await kb.press('Enter');
await kb.press('Tab');
await kb.down('Shift');
await kb.up('Shift');
await kb.type('Hello World', { delay: 30 });
await kb.insertText('pasted text');   // inserts at cursor position
```

**Special keys handled:** `Enter` (submits form / clicks button), `Tab` (moves focus to next focusable element).

---

## Mouse Sub-API

```js
const m = window.__page.mouse;

await m.move(100, 200, { steps: 5 });   // smooth multi-step movement
await m.down();
await m.up();
await m.click(100, 200, { button: 'right' });
await m.dblclick(300, 400);
await m.wheel(0, 300);                  // scroll down 300px
```

---

## Touchscreen Sub-API

```js
await window.__page.touchscreen.tap(150, 250);  // fires touchstart + touchend + click
```

---

## Waiting

```js
// Wait for element state
const el = await window.__page.waitForSelector('#result');
const el = await window.__page.waitForSelector('.modal', { state: 'visible', timeout: 5000 });
const el = await window.__page.waitForSelector('.spinner', { state: 'detached' });
// states: 'attached' | 'detached' | 'visible' | 'hidden'

// Wait for condition
await window.__page.waitForFunction(() => document.querySelectorAll('li').length > 5);
await window.__page.waitForFunction('window.__ready === true');

// Fixed delay
await window.__page.waitForTimeout(1000);

// Network (fetch-intercept only — fires only for fetch after this point)
const req  = await window.__page.waitForRequest('/api/data');
const resp = await window.__page.waitForResponse('/api/data');

// Internal event
await window.__page.waitForEvent('console');
await window.__page.waitForEvent('load');
```

---

## Attributes & Content

```js
await window.__page.getAttribute('#link', 'href');
await window.__page.innerHTML('.content');
await window.__page.innerText('h1');
await window.__page.textContent('p.desc');
await window.__page.inputValue('input[name=q]');
```

---

## State Checks

```js
await window.__page.isVisible('#modal');
await window.__page.isHidden('.spinner');
await window.__page.isEnabled('#submit');
await window.__page.isDisabled('#submit');
await window.__page.isChecked('input[type=checkbox]');
await window.__page.isEditable('input[name=email]');
       window.__page.isClosed();   // always false — we're inside the page
```

---

## HTTP Requests (`request` sub-API)
Wraps `fetch`. All methods return a native `Response` promise.
```js
const r = window.__page.request;
const resp = await r.get('/api/items');
const resp = await r.post('/api/items', { body: JSON.stringify({ name: 'x' }), headers: { 'Content-Type': 'application/json' } });
```

---


## Frames

```js
// Frame locator (scoped to iframe)
const fl = window.__page.frameLocator('#my-iframe');
await fl.locator('button').click();
await fl.getByRole('textbox').fill('hello');
const fw = window.__page.frame('#my-iframe');      // by CSS selector → contentWindow
```

---

## ARIA Snapshot

Returns a text tree of ARIA roles and labels, useful for assertions:

```js
const snapshot = await window.__page.ariaSnapshot();
const snapshot = await window.__page.ariaSnapshot({ depth: 5 });
// Returns:
// - body ""
//   - button "Submit" [disabled]
//   - heading "Welcome"
//   - textbox "Email" [readonly]
```

---

## Locator Handlers (auto-dismiss overlays)

```js
const dismissBtn = window.__page.locator('.cookie-banner button');
await window.__page.addLocatorHandler(dismissBtn, async (loc) => {
  await loc.click();
}, { times: 3 });    // only run up to 3 times

await window.__page.removeLocatorHandler(dismissBtn);
```

---

## Console & Error Tracking

```js
// **ALWAYS** write logs and errors to the console so the agent can see them
console.log(text)
---


## Locator Picker

```js
const picked = await window.__page.pickLocator();
// User clicks an element → returns a Locator for it
await window.__page.cancelPickLocator();
await window.__page.hideHighlight();   // removes any [data-pw-highlight] overlays
```

---

## Stubbed / Unavailable Features

The following require CDP/V8/Node.js and **throw or return empty** at runtime:

| Method | Behaviour |
|---|---|
| `screenshot()` | Returns a 1×1 transparent PNG data-URI, logs error |
| `pdf()` | Throws `Error: pdf() currently unvalaible` |
| `coverage.startJSCoverage()` | `console.warn` — requires CDP/V8 |
| `routeFromHAR()` | Throws — requires Node.js |
| `routeWebSocket()` | Throws — requires CDP |
| `waitForRequest/Response` | Only intercepts **fetch** calls, not XHR |
| `context()` | Returns `null` |
| `video()` | Returns `null` |
| `workers()` | Returns `[]` |

---


# `control_dom` tool
tool lets you control any open Tauri child webview
using evaluate `js_code`, you can utilize `Playwright Page API polyfill`

## Tool Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `target_webview` | string | ❌ | Tauri label of the webview, it starts with `webview-agent-{uuid}` and ends with `uuid` |
| `js_code` | string | ✅ |  javascript code to evaluate |
---

## Examples

```python
code_to_evaluate = """
    const loc = window.__page.getByRole('button', { name: 'Submit' });
    await loc.click();
    console.log("Submit button clicked");
"""
await control_dom(target_webview="target_webview_label", js_code=code_to_evaluate)
```
