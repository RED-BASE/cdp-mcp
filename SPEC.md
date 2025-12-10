# CDP MCP - Chrome DevTools Protocol Model Context Protocol Server

A general-purpose browser automation MCP server that exposes Chrome DevTools Protocol capabilities to AI agents.

## Overview

CDP MCP provides AI agents with the ability to interact with web pages through a set of tools that abstract common browser automation tasks. Unlike purpose-built MCPs (e.g., for specific web apps), CDP MCP is designed to work with any website.

---

## Tools

### 0. `cdp_launch`
Launch a Chrome/Chromium instance with CDP enabled.

This solves the pain point of users having to figure out the command line flags. CDP MCP manages its own browser instance with a dedicated profile.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `port` | integer | no | 9222 | CDP debugging port |
| `headless` | boolean | no | false | Run headless (no visible window) |
| `browser` | string | no | auto | Browser to use: `chrome`, `chromium`, `edge`, `auto` |
| `profile` | string | no | cdp-mcp-default | Profile name (creates isolated user data dir) |
| `width` | integer | no | 1280 | Window width |
| `height` | integer | no | 900 | Window height |
| `start_url` | string | no | about:blank | URL to open on launch |
| `extensions` | array | no | [] | Paths to extensions to load |
| `args` | array | no | [] | Additional Chrome args |

**Browser Detection Order (when `auto`):**
1. `$CHROME_PATH` environment variable
2. `google-chrome` / `google-chrome-stable`
3. `chromium` / `chromium-browser`
4. `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` (macOS)
5. `C:\Program Files\Google\Chrome\Application\chrome.exe` (Windows)
6. `/opt/google/chrome/chrome` (Linux)
7. Microsoft Edge (fallback)

**User Data Directory:**
- Created at `~/.cdp-mcp/profiles/{profile_name}/`
- Each profile is isolated (cookies, history, extensions separate)
- Default profile: `~/.cdp-mcp/profiles/cdp-mcp-default/`
- Persists between sessions (can reuse login state)

**Chrome Flags Applied Automatically:**
```
--remote-debugging-port={port}
--user-data-dir={profile_dir}
--no-first-run
--no-default-browser-check
--disable-background-networking
--disable-client-side-phishing-detection
--disable-default-apps
--disable-hang-monitor
--disable-popup-blocking
--disable-prompt-on-repost
--disable-sync
--disable-translate
--metrics-recording-only
--safebrowsing-disable-auto-update
--password-store=basic
```

**Additional flags for headless:**
```
--headless=new
--disable-gpu
--hide-scrollbars
--mute-audio
```

**Returns:**
```json
{
  "launched": true,
  "browser": "Google Chrome",
  "version": "142.0.7444.134",
  "port": 9222,
  "pid": 12345,
  "profile": "cdp-mcp-default",
  "profile_path": "/home/user/.cdp-mcp/profiles/cdp-mcp-default",
  "flags": ["--remote-debugging-port=9222", "..."]
}
```

**Error Cases:**
```json
{
  "launched": false,
  "error": "no_browser_found",
  "message": "Could not find Chrome, Chromium, or Edge. Install one or set $CHROME_PATH.",
  "searched": ["/usr/bin/google-chrome", "/usr/bin/chromium", "..."]
}
```

```json
{
  "launched": false,
  "error": "port_in_use",
  "message": "Port 9222 is already in use. Use a different port or connect to existing instance.",
  "suggestion": "cdp_connect(port=9222) or cdp_launch(port=9223)"
}
```

---

### 1. `cdp_connect`
Connect to an already-running Chrome/Chromium instance.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `port` | integer | no | 9222 | CDP debugging port |
| `host` | string | no | localhost | CDP host |

**Returns:**
```json
{
  "connected": true,
  "browser": "Chrome/142.0.7444.134",
  "tabs": 5
}
```

---

### 2. `cdp_list_tabs`
List all open browser tabs.

**Parameters:** None

**Returns:**
```json
{
  "tabs": [
    {"id": 0, "title": "Google", "url": "https://google.com"},
    {"id": 1, "title": "Apollo Research - Evaluations Engineer", "url": "https://jobs.lever.co/..."}
  ]
}
```

---

### 3. `cdp_navigate`
Navigate to a URL or perform navigation actions.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `tab` | integer | no | Tab index (default: active tab) |
| `url` | string | no | URL to navigate to |
| `action` | string | no | `back`, `forward`, `refresh` |
| `wait_until` | string | no | `load`, `domcontentloaded`, `networkidle` |

**Returns:**
```json
{
  "url": "https://example.com",
  "title": "Example Domain",
  "status": 200
}
```

---

### 4. `cdp_find_elements`
Discover interactive elements on the page.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `tab` | integer | no | Tab index |
| `filter` | string | no | Filter by type: `all`, `forms`, `inputs`, `buttons`, `links`, `media`, `custom` |
| `selector` | string | no | CSS selector to scope search |
| `include_hidden` | boolean | no | Include hidden elements (default: false) |

**Returns:**
```json
{
  "elements": [
    {
      "index": 0,
      "tag": "input",
      "type": "text",
      "selector": "#name-field",
      "name": "full_name",
      "label": "Full Name",
      "placeholder": "Enter your name",
      "value": "",
      "required": true,
      "disabled": false,
      "visible": true,
      "rect": {"x": 100, "y": 200, "width": 300, "height": 40}
    },
    {
      "index": 1,
      "tag": "input",
      "type": "file",
      "selector": "#resume-upload",
      "name": "resume",
      "label": "Upload Resume",
      "accept": ".pdf,.doc,.docx",
      "multiple": false
    },
    {
      "index": 2,
      "tag": "button",
      "type": "submit",
      "selector": "button[type='submit']",
      "text": "Apply Now",
      "disabled": false
    },
    {
      "index": 3,
      "tag": "a",
      "selector": "a.learn-more",
      "text": "Learn More",
      "href": "/about"
    },
    {
      "index": 4,
      "tag": "select",
      "selector": "#country",
      "name": "country",
      "label": "Country",
      "options": [
        {"value": "us", "text": "United States", "selected": false},
        {"value": "uk", "text": "United Kingdom", "selected": true}
      ]
    },
    {
      "index": 5,
      "tag": "div",
      "role": "button",
      "selector": "[role='button'].custom-btn",
      "text": "Custom Button",
      "aria_label": "Submit form"
    }
  ],
  "forms": [
    {
      "selector": "#apply-form",
      "action": "/submit",
      "method": "POST",
      "fields": [0, 1, 4],
      "submit_button": 2
    }
  ],
  "summary": {
    "total": 6,
    "inputs": 2,
    "buttons": 2,
    "links": 1,
    "selects": 1,
    "custom_interactive": 1
  }
}
```

---

### 5. `cdp_read`
Read content from the page.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `tab` | integer | no | Tab index |
| `target` | string | no | What to read: `page`, `selection`, `element`, `attribute`, `computed_style` |
| `selector` | string | no | CSS selector for element target |
| `attribute` | string | no | Attribute name to read |
| `format` | string | no | `text`, `html`, `markdown` |

**Returns:**
```json
{
  "content": "Page text content here...",
  "title": "Page Title",
  "url": "https://example.com",
  "meta": {
    "description": "Page description",
    "og:image": "https://..."
  }
}
```

---

### 6. `cdp_interact`
Interact with elements on the page.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `tab` | integer | no | Tab index |
| `action` | string | yes | Action type (see below) |
| `selector` | string | no | CSS selector |
| `index` | integer | no | Element index from `cdp_find_elements` |
| `value` | string | no | Value for type/select actions |
| `file_path` | string | no | File path for upload actions |
| `options` | object | no | Additional options |

**Actions:**

| Action | Description | Required Params |
|--------|-------------|-----------------|
| `click` | Click element | selector or index |
| `dblclick` | Double-click element | selector or index |
| `rightclick` | Right-click (context menu) | selector or index |
| `hover` | Hover over element | selector or index |
| `type` | Type text into input | selector/index + value |
| `clear` | Clear input value | selector or index |
| `select` | Select dropdown option | selector/index + value |
| `check` | Check checkbox | selector or index |
| `uncheck` | Uncheck checkbox | selector or index |
| `toggle` | Toggle checkbox state | selector or index |
| `upload` | Upload file | selector/index + file_path |
| `focus` | Focus element | selector or index |
| `blur` | Blur (unfocus) element | selector or index |
| `scroll_to` | Scroll element into view | selector or index |
| `drag_to` | Drag element to target | selector + options.target |
| `press` | Press key | options.key |
| `submit` | Submit form | selector (form) |

**Options object:**
```json
{
  "delay": 100,           // Typing delay in ms
  "click_count": 1,       // Number of clicks
  "button": "left",       // Mouse button: left, right, middle
  "modifiers": ["shift"], // Key modifiers: shift, ctrl, alt, meta
  "target": "#drop-zone", // Target for drag_to
  "key": "Enter",         // Key for press action
  "force": false,         // Click even if not visible
  "timeout": 5000         // Action timeout in ms
}
```

**Returns:**
```json
{
  "success": true,
  "action": "type",
  "selector": "#name-field",
  "value": "Cassius Oldenburg",
  "element": {
    "tag": "input",
    "type": "text",
    "value_after": "Cassius Oldenburg"
  }
}
```

---

### 7. `cdp_screenshot`
Capture screenshot of page or element.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `tab` | integer | no | Tab index |
| `selector` | string | no | Element to capture (full page if omitted) |
| `format` | string | no | `png`, `jpeg`, `webp` |
| `quality` | integer | no | JPEG/WebP quality (0-100) |
| `full_page` | boolean | no | Capture full scrollable page |
| `path` | string | no | Save to file path |

**Returns:**
```json
{
  "format": "png",
  "width": 1920,
  "height": 1080,
  "path": "/tmp/screenshot.png",
  "base64": "iVBORw0KGgo..."
}
```

---

### 8. `cdp_wait`
Wait for conditions to be met.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `tab` | integer | no | Tab index |
| `condition` | string | yes | Condition type (see below) |
| `selector` | string | no | CSS selector for element conditions |
| `value` | string | no | Value to match |
| `timeout` | integer | no | Timeout in ms (default: 30000) |

**Conditions:**

| Condition | Description |
|-----------|-------------|
| `element_visible` | Wait for element to be visible |
| `element_hidden` | Wait for element to be hidden |
| `element_exists` | Wait for element to exist in DOM |
| `element_removed` | Wait for element to be removed |
| `text_contains` | Wait for element text to contain value |
| `value_equals` | Wait for input value to equal value |
| `navigation` | Wait for navigation to complete |
| `network_idle` | Wait for network to be idle |
| `function` | Wait for JS function to return truthy |

**Returns:**
```json
{
  "success": true,
  "condition": "element_visible",
  "selector": "#success-message",
  "waited_ms": 1250
}
```

---

### 9. `cdp_diff`
Detect changes since last snapshot.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `tab` | integer | no | Tab index |
| `create_snapshot` | boolean | no | Create new snapshot (default: false) |
| `selector` | string | no | Scope diff to element subtree |

**Returns:**
```json
{
  "changed": true,
  "changes": {
    "url": {"from": "https://a.com", "to": "https://b.com"},
    "title": {"from": "Page A", "to": "Page B"},
    "elements_added": [
      {"selector": "#success-toast", "text": "Application submitted!"}
    ],
    "elements_removed": [
      {"selector": "#submit-btn"}
    ],
    "elements_modified": [
      {
        "selector": "#status",
        "attribute": "textContent",
        "from": "Pending",
        "to": "Complete"
      }
    ],
    "forms": {
      "#apply-form": {
        "fields_changed": ["#name", "#email"],
        "submitted": true
      }
    }
  },
  "snapshot_id": "snap_12345"
}
```

---

### 10. `cdp_execute`
Execute JavaScript in page context.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `tab` | integer | no | Tab index |
| `script` | string | yes | JavaScript to execute |
| `args` | array | no | Arguments to pass to script |
| `await_promise` | boolean | no | Wait for promise resolution |

**Returns:**
```json
{
  "result": "returned value",
  "type": "string",
  "logs": ["console.log output"]
}
```

---

### 11. `cdp_network`
Monitor and intercept network requests.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `tab` | integer | no | Tab index |
| `action` | string | yes | `monitor`, `get_requests`, `clear` |
| `filter` | object | no | Filter requests by URL pattern, method, type |

**Returns:**
```json
{
  "requests": [
    {
      "url": "https://api.example.com/submit",
      "method": "POST",
      "status": 200,
      "type": "xhr",
      "request_body": {"name": "Cassius"},
      "response_body": {"success": true},
      "timing": {"start": 0, "end": 150}
    }
  ]
}
```

---

### 12. `cdp_cookies`
Manage browser cookies.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `action` | string | yes | `get`, `set`, `delete`, `clear` |
| `name` | string | no | Cookie name |
| `value` | string | no | Cookie value (for set) |
| `domain` | string | no | Cookie domain |
| `url` | string | no | URL to scope cookies |

**Returns:**
```json
{
  "cookies": [
    {"name": "session", "value": "abc123", "domain": ".example.com"}
  ]
}
```

---

## Exhaustive Element Types Detected by `cdp_find_elements`

### Native Interactive Elements (Focusable by Default)

| Element | Interaction Types |
|---------|-------------------|
| `<input type="text">` | type, clear, focus, blur |
| `<input type="password">` | type, clear, focus, blur |
| `<input type="email">` | type, clear, focus, blur |
| `<input type="url">` | type, clear, focus, blur |
| `<input type="tel">` | type, clear, focus, blur |
| `<input type="search">` | type, clear, focus, blur |
| `<input type="number">` | type, clear, focus, blur (+ spinner) |
| `<input type="range">` | drag, set value |
| `<input type="date">` | type, picker, focus, blur |
| `<input type="time">` | type, picker, focus, blur |
| `<input type="datetime-local">` | type, picker, focus, blur |
| `<input type="month">` | type, picker, focus, blur |
| `<input type="week">` | type, picker, focus, blur |
| `<input type="color">` | picker, set value |
| `<input type="file">` | upload |
| `<input type="checkbox">` | check, uncheck, toggle |
| `<input type="radio">` | select |
| `<input type="submit">` | click |
| `<input type="reset">` | click |
| `<input type="button">` | click |
| `<input type="image">` | click |
| `<input type="hidden">` | (not interactive) |
| `<textarea>` | type, clear, focus, blur |
| `<select>` | select, focus, blur |
| `<select multiple>` | select (multiple), focus, blur |
| `<button>` | click |
| `<a href="...">` | click, hover |
| `<area href="...">` | click |
| `<summary>` | click (expand/collapse) |
| `<details>` | toggle |
| `<dialog>` | showModal, close |
| `<iframe>` | navigate, interact (nested) |

### ARIA Role-Based Interactive Elements

| Role | Equivalent Behavior |
|------|---------------------|
| `role="button"` | click |
| `role="link"` | click |
| `role="checkbox"` | toggle |
| `role="radio"` | select |
| `role="switch"` | toggle |
| `role="slider"` | drag, set value |
| `role="spinbutton"` | increment, decrement |
| `role="textbox"` | type, clear |
| `role="searchbox"` | type, clear |
| `role="combobox"` | type, select |
| `role="listbox"` | select |
| `role="option"` | select |
| `role="menu"` | open |
| `role="menuitem"` | click |
| `role="menuitemcheckbox"` | toggle |
| `role="menuitemradio"` | select |
| `role="tab"` | click |
| `role="tabpanel"` | (content area) |
| `role="treeitem"` | expand, select |
| `role="gridcell"` | click, edit |
| `role="row"` | select |

### Made Interactive via Attributes

| Attribute | Effect |
|-----------|--------|
| `tabindex="0"` | Added to tab order, focusable |
| `tabindex="-1"` | Focusable via JS only |
| `contenteditable="true"` | Editable text |
| `draggable="true"` | Draggable |
| `onclick` / event handlers | Clickable |
| `data-*` (custom) | May indicate JS interactivity |

### State Attributes

| Attribute | Effect |
|-----------|--------|
| `disabled` | Ignores input |
| `readonly` | Displays but no edit |
| `required` | Must be filled |
| `checked` | Checkbox/radio state |
| `selected` | Option state |
| `open` | Details/dialog state |
| `inert` | Completely non-interactive |
| `hidden` | Not rendered |
| `aria-disabled="true"` | Semantic disabled |
| `aria-hidden="true"` | Hidden from a11y |
| `aria-expanded` | Expandable state |
| `aria-pressed` | Toggle button state |
| `aria-checked` | Checkbox state |
| `aria-selected` | Selection state |

### Media Elements

| Element | Interactions |
|---------|--------------|
| `<video>` | play, pause, seek, volume, fullscreen |
| `<audio>` | play, pause, seek, volume |
| `<canvas>` | click coordinates, draw |

### Browser-Provided UI Components

These are sub-elements of standard elements that browsers render:
- Spinner buttons on `<input type="number">`
- Clear button on `<input type="search">`
- Dropdown arrow on `<select>`
- Date picker calendar
- Color picker swatch
- Video/audio controls (play, pause, volume, scrubber, fullscreen)
- Scrollbars

---

## Event Types (for monitoring/waiting)

### Mouse Events
`click`, `dblclick`, `mousedown`, `mouseup`, `mouseover`, `mouseout`, `mousemove`, `mouseenter`, `mouseleave`, `contextmenu`, `auxclick`

### Keyboard Events
`keydown`, `keyup`, `keypress` (deprecated)

### Focus Events
`focus`, `blur`, `focusin`, `focusout`

### Form Events
`submit`, `reset`, `change`, `input`, `invalid`, `formdata`

### Drag Events
`drag`, `dragstart`, `dragend`, `dragenter`, `dragleave`, `dragover`, `drop`

### Clipboard Events
`copy`, `cut`, `paste`

### Touch Events
`touchstart`, `touchend`, `touchmove`, `touchcancel`

### Pointer Events
`pointerdown`, `pointermove`, `pointerup`, `pointercancel`, `pointerover`, `pointerout`, `pointerenter`, `pointerleave`, `gotpointercapture`, `lostpointercapture`

### Wheel Events
`wheel`

### Animation Events
`animationstart`, `animationend`, `animationiteration`, `animationcancel`

### Transition Events
`transitionstart`, `transitionend`, `transitioncancel`, `transitionrun`

### Media Events
`loadstart`, `progress`, `suspend`, `abort`, `error`, `emptied`, `stalled`, `loadedmetadata`, `loadeddata`, `canplay`, `canplaythrough`, `playing`, `pause`, `ended`, `seeking`, `seeked`, `durationchange`, `timeupdate`, `ratechange`, `volumechange`

### Page Lifecycle Events
`load`, `unload`, `beforeunload`, `pageshow`, `pagehide`, `visibilitychange`, `resize`, `scroll`

### Network Events
`online`, `offline`

### Print Events
`beforeprint`, `afterprint`

### Fullscreen Events
`fullscreenchange`, `fullscreenerror`

### History Events
`popstate`, `hashchange`

### Selection Events
`selectionchange`, `selectstart`

### Composition Events (IME)
`compositionstart`, `compositionupdate`, `compositionend`

### Custom/Framework Events
Any custom events dispatched via `dispatchEvent()`

---

## Implementation Notes

### Connection Management
- Connect via WebSocket to Chrome DevTools Protocol
- Support multiple simultaneous tab connections
- Auto-reconnect on connection loss
- Connection pooling for parallel operations

### Element Discovery Strategy
1. Query all standard interactive elements
2. Query all elements with ARIA roles
3. Query all elements with tabindex
4. Query all elements with event handlers (onclick, etc.)
5. Query all contenteditable elements
6. Filter by visibility unless `include_hidden: true`
7. Build selector for each (prefer #id > [data-testid] > .class > tag)

### Interaction Reliability
- Auto-wait for element to be visible and enabled
- Scroll into view before interaction
- Retry on stale element reference
- Support Shadow DOM traversal
- Handle iframes recursively

### Security Considerations
- Never execute arbitrary JS without explicit `cdp_execute` call
- Sanitize selectors to prevent injection
- Log all interactions for audit trail
- Support allowlist/blocklist of domains

---

## Example Usage: Fill Job Application

```
# 0. Launch browser (if not already running)
cdp_launch(port=9222, profile="job-applications")

# 1. Or connect to existing browser
cdp_connect(port=9222)

# 2. Navigate to application
cdp_navigate(url="https://jobs.lever.co/apolloresearch/...")

# 3. Discover form fields
elements = cdp_find_elements(filter="forms")

# 4. Fill form
cdp_interact(action="type", selector="#name", value="Cassius Oldenburg")
cdp_interact(action="type", selector="#email", value="connect@cassius.red")
cdp_interact(action="type", selector="#phone", value="971-895-2210")
cdp_interact(action="upload", selector="#resume", file_path="/path/to/resume.pdf")
cdp_interact(action="type", selector="#cover-letter", value="...")
cdp_interact(action="type", selector="#links", value="https://github.com/RED-BASE")

# 5. Submit
cdp_interact(action="click", selector="button[type='submit']")

# 6. Wait for confirmation
cdp_wait(condition="text_contains", selector="body", value="Application submitted")

# 7. Screenshot for records
cdp_screenshot(path="/path/to/confirmation.png")
```

---

## File Structure

```
cdp-mcp/
├── SPEC.md                    # This file
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts               # MCP server entry
│   ├── cdp-client.ts          # CDP WebSocket client
│   ├── browser-launcher.ts    # Browser detection & launch
│   ├── tools/
│   │   ├── launch.ts          # cdp_launch
│   │   ├── connect.ts         # cdp_connect
│   │   ├── list-tabs.ts       # cdp_list_tabs
│   │   ├── navigate.ts        # cdp_navigate
│   │   ├── find-elements.ts   # cdp_find_elements
│   │   ├── interact.ts        # cdp_interact
│   │   ├── read.ts            # cdp_read
│   │   ├── screenshot.ts      # cdp_screenshot
│   │   ├── wait.ts            # cdp_wait
│   │   ├── diff.ts            # cdp_diff
│   │   ├── execute.ts         # cdp_execute
│   │   ├── network.ts         # cdp_network
│   │   └── cookies.ts         # cdp_cookies
│   └── utils/
│       ├── selectors.ts       # Selector generation
│       ├── element-info.ts    # Element metadata extraction
│       ├── snapshot.ts        # Page state snapshots
│       └── browser-paths.ts   # Cross-platform browser detection
└── profiles/                  # Created at ~/.cdp-mcp/profiles/
    └── cdp-mcp-default/       # Default Chrome user data dir
```

---

## Installation & Setup

### Install from npm (once published)
```bash
npm install -g cdp-mcp
```

### Or clone and build
```bash
git clone https://github.com/RED-BASE/cdp-mcp
cd cdp-mcp
npm install
npm run build
```

### Add to Claude Code MCP config

**macOS/Linux:** `~/.config/claude-code/mcp.json`
**Windows:** `%APPDATA%\claude-code\mcp.json`

```json
{
  "mcpServers": {
    "cdp": {
      "command": "cdp-mcp",
      "args": []
    }
  }
}
```

### Or run directly
```bash
npx cdp-mcp
```

### First Run

On first use, CDP MCP will:
1. Detect available browsers on your system
2. Create `~/.cdp-mcp/` directory for profiles and config
3. Create default profile at `~/.cdp-mcp/profiles/cdp-mcp-default/`

### Configuration File (Optional)

`~/.cdp-mcp/config.json`:
```json
{
  "default_browser": "chrome",
  "default_port": 9222,
  "default_profile": "cdp-mcp-default",
  "headless": false,
  "window": {
    "width": 1280,
    "height": 900
  },
  "allowed_domains": [],
  "blocked_domains": [],
  "log_interactions": true,
  "log_path": "~/.cdp-mcp/logs/"
}
```

---

## Browser Requirements

CDP MCP requires one of:
- Google Chrome (recommended)
- Chromium
- Microsoft Edge (Chromium-based)
- Brave (experimental)

The browser must support Chrome DevTools Protocol (all Chromium-based browsers do).

### Verifying CDP Works

```bash
# Launch Chrome with CDP manually
google-chrome --remote-debugging-port=9222

# Test CDP is working
curl http://localhost:9222/json/version
```

If this returns JSON with browser info, CDP is working.

---

## References

- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
- [Puppeteer API](https://pptr.dev/api)
- [Playwright API](https://playwright.dev/docs/api/class-playwright)
- [MDN HTML Elements](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements)
- [WAI-ARIA Roles](https://www.w3.org/TR/wai-aria/)
- [MDN Events Reference](https://developer.mozilla.org/en-US/docs/Web/Events)
- [MCP Specification](https://modelcontextprotocol.io/)
