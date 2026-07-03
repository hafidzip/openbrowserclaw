---
name: control_browser
description: >
  Use this skill when asked to automate browser actions like navigating, clicking,
  typing, double-clicking, uploading files, dragging, scrolling, checking checkboxes,
  taking screenshots, reading console/network logs, handling cookies,
  managing localStorage/sessionStorage, routing network requests, or running JavaScript inside a webview.
---

# control_browser — Agent Skill

## Overview

The `control_browser` tool lets you control any open Tauri child webview
using Python Playwright via the Chrome DevTools Protocol (CDP).

---

## Tool Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `action` | string (enum) | ✅ | The action to perform (see list below) |
| `ref` | string | ❌ | Element reference from a previous `snapshot` call (e.g., `e12`). Re-scans accessibility tree to resolve. Takes precedence over `selector` |
| `selector` | string | depends | CSS or XPath selector (e.g. `#search`, `button[type=submit]`) |
| `value` | string | depends | Context-dependent value (URL / text / key / JS / JSON / etc.) |
---

## Actions Reference

### Observation & Diagnostics
| Action | Description | Key Params |
|---|---|---|
| `snapshot` | Returns a textual accessibility tree with element references (e.g. `[e1]`, `[e2]`) and labels. Use this first to locate elements! | — |
| `screenshot` | Capture a PNG (returned as base64) | — |
| `get_text` | Get `innerText` of an element | `ref` or `selector` |
| `evaluate` | Run JavaScript and return the result | `value`=JS expression |
| `console` | Return recent console logs captured on the page | — |
| `requests` | Return recent HTTP request method/URLs made by the page | — |

### Navigation
| Action | Description | Key Params |
|---|---|---|
| `navigate` | Load a URL in the webview | `value`=URL |
| `go_back` | Browser back | — |
| `go_forward` | Browser forward | — |
| `reload` | Reload page | — |
| `list_webviews` | List all Tauri webview windows with their labels | — |

### Interaction
| Action | Description | Key Params |
|---|---|---|
| `click` | Click an element | `ref` or `selector` |
| `dblclick` | Double-click an element | `ref` or `selector` |
| `type` | Fill / type text into an input field (replaces current content) | `ref` or `selector`, `value`=text |
| `press` | Press a single key (Enter, Tab, Escape, ArrowDown, Backspace...) | `value`=key, `ref` or `selector` (optional target) |
| `keydown` | Press and hold a key | `value`=key |
| `keyup` | Release a key | `value`=key |
| `hover` | Hover mouse over an element | `ref` or `selector` |
| `select` | Select an option in a `<select>` | `ref` or `selector`, `value`=option label |
| `check` | Check a checkbox or radio button | `ref` or `selector` |
| `uncheck` | Uncheck a checkbox | `ref` or `selector` |
| `upload` | Upload a file | `ref` or `selector`, `value`=absolute file path |
| `scroll` | Scroll page | `value`=`"x,y"` (e.g. `"0,500"`) |
| `resize` | Set viewport dimensions | `value`=`"width,height"` (e.g. `"1280,720"`) |

### Dialogs
| Action | Description | Key Params |
|---|---|---|
| `dialog_accept` | Registers a listener to accept the next modal dialog (alert/prompt/confirm) | `value`=optional text for prompt dialogs |
| `dialog_dismiss` | Registers a listener to dismiss the next modal dialog | — |

### Mouse Actions
| Action | Description | Key Params |
|---|---|---|
| `mousemove` | Move mouse to absolute screen coordinates | `value`=`"x,y"` |
| `mousedown` | Press down mouse button | `value`=`"left"`/`"right"`/`"middle"` |
| `mouseup` | Release mouse button | `value`=`"left"`/`"right"`/`"middle"` |

### Cookie Management
| Action | Description | Key Params |
|---|---|---|
| `cookie_list` | List all cookies for the current context | — |
| `cookie_get` | Find cookies matching a name | `value`=cookie name |
| `cookie_set` | Add/set a cookie | `value`=JSON string (e.g. `{"name":"sid","value":"123"}`) |
| `cookie_delete` | Delete a cookie | `value`=cookie name |
| `cookie_clear` | Clear all cookies | — |

### Web Storage (LocalStorage & SessionStorage)
| Action | Description | Key Params |
|---|---|---|
| `localstorage_get` | Get localStorage value | `value`=key |
| `localstorage_delete` | Delete localStorage key | `value`=key |
| `localstorage_clear` | Clear localStorage | — |
| `sessionstorage_get` | Get sessionStorage value | `value`=key |
| `sessionstorage_delete`| Delete sessionStorage key | `value`=key |
| `sessionstorage_clear` | Clear sessionStorage | — |

### Network Request Routing
| Action | Description | Key Params |
|---|---|---|
| `route` | Intercept and mock network requests matching a URL pattern | `value`=JSON string containing `url_pattern`, `status`, `body`, `headers`. E.g., `{"url_pattern":"**/api/user","status":200,"body":"{}"}` |

---

## Step-by-Step Patterns

### Pattern 1 — Locating and Clicking Elements using Refs (Recommended)

Instead of guessing CSS selectors, call `snapshot` to get the accessibility tree. It annotates interactive nodes with references (`e1`, `e2`, etc.):

```python
# 1. Take a snapshot to see the page structure
res = await control_browser(action="snapshot")
print(res["snapshot"])
# Example output:
#   document "Google"
#     [e1] textbox "Search"
#     [e2] button "Google Search"

# 2. Type into the textbox using its reference
await control_browser(action="type", ref="e1", value="playwright python")

# 3. Press Enter to search
await control_browser(action="press", ref="e1", value="Enter")
```

### Pattern 2 — Mocking an API Endpoint (`route`)

```python
# Mock response for /api/config
mock_config = {
    "url_pattern": "**/api/config",
    "status": 200,
    "body": '{"theme": "dark", "features": ["playwright"]}',
    "headers": {"Content-Type": "application/json"}
}
import json
await control_browser(action="route", value=json.dumps(mock_config))

# Navigate - the mock will be active for requests made during this page load
await control_browser(action="navigate", value="https://example.com/app")
```

### Pattern 3 — Handling Alert Modals

```python
# Register a listener to accept next confirm modal with 'Yes' value
await control_browser(action="dialog_accept", value="Yes")

# Now trigger the button click that spawns the confirm dialog
await control_browser(action="click", selector="#delete-btn")
```

### Pattern 4 — Cookie Authentication Injector

```python
cookie_data = {
    "name": "session_token",
    "value": "xyz123abc",
    "domain": "example.com"
}
import json
await control_browser(action="cookie_set", value=json.dumps(cookie_data))

await control_browser(action="navigate", value="https://example.com/dashboard")
```

### Pattern 5 — Executing Custom JavaScript (`evaluate`)

To run arbitrary JavaScript in the context of the page and retrieve the output:

```python
# Evaluate a simple JavaScript expression
res = await control_browser(action="evaluate", value="window.location.origin")
print("Origin:", res["result"])

# Query details about the page DOM
res = await control_browser(
    action="evaluate", 
    value="document.querySelectorAll('a').length"
)
print("Number of links on page:", res["result"])

# Execute a complex script (must return a JSON-serializable value or a promise that resolves to one)
script = """
(() => {
    const title = document.title;
    const bodyLength = document.body.innerText.length;
    return { title, bodyLength };
})()
"""
res = await control_browser(action="evaluate", value=script)
print("Page Data:", res["result"])
```

