# CDP MCP

A minimal Chrome DevTools Protocol MCP server for browser automation. 10 tools, ~700 lines, built for agents that need to fill forms and navigate sites.

## Why This Exists

Most browser automation MCPs are either:
- Wrappers around heavyweight frameworks (Playwright, Puppeteer)
- Locked to specific sites
- Missing element discovery (you have to guess selectors)

CDP MCP talks directly to Chrome via the DevTools Protocol. It auto-discovers interactive elements, generates selectors for you, and verifies that interactions actually worked.

## Installation

```bash
npm install
npm run build
```

## Usage

Add to your Claude Code MCP config (`~/.claude.json`):

```json
{
  "mcpServers": {
    "cdp": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/cdp-mcp/dist/index.js"]
    }
  }
}
```

Then either:
1. Launch Chrome with CDP enabled: `cdp_launch`
2. Or connect to an existing Chrome with `--remote-debugging-port=9222`: `cdp_connect`

## Tools

| Tool | Purpose |
|------|---------|
| `cdp_launch` | Launch Chrome with CDP enabled, isolated profile |
| `cdp_connect` | Connect to existing Chrome instance |
| `cdp_list_tabs` | List all open tabs |
| `cdp_navigate` | Go to URL, back, forward, refresh |
| `cdp_find_elements` | **Discover all interactive elements with auto-generated selectors** |
| `cdp_interact` | Click, type, check, select, upload - **with built-in verification** |
| `cdp_read` | Read page text, element text, input values |
| `cdp_screenshot` | Capture viewport or full page |
| `cdp_wait` | Wait for element, text, navigation |
| `cdp_execute` | Run arbitrary JavaScript (escape hatch) |

## Key Features

### Auto-Discovery

`cdp_find_elements` returns every interactive element on the page with:
- Tag, type, id, name, class
- Associated label (from `<label>`, `aria-label`, etc.)
- Auto-generated CSS selector
- Visibility and position

No more guessing selectors or inspecting the DOM manually.

### Built-in Verification

`cdp_interact` verifies that actions actually worked:

```json
{
  "success": true,
  "action": "type",
  "selector": "#email",
  "expected": "user@example.com",
  "actual": "user@example.com",
  "verified": true
}
```

If a React controlled input silently rejects your value, you'll know immediately.

### Minimal Dependencies

- `ws` - WebSocket client for CDP
- That's it

No Playwright. No Puppeteer. Just raw CDP over WebSocket.

## Example Workflow

```
1. cdp_connect              → Connect to Chrome on port 9222
2. cdp_navigate             → Go to a form page
3. cdp_find_elements        → Get all inputs with selectors
4. cdp_interact (type)      → Fill fields, get verification
5. cdp_interact (click)     → Submit
6. cdp_wait (navigation)    → Wait for redirect
7. cdp_read                 → Confirm success
```

## Design Philosophy

- **10 tools, not 30** - Everything an agent needs, nothing it doesn't
- **CSS selectors** - Universal, inspectable, copy-pasteable
- **Verification by default** - Know if it worked without extra calls
- **`cdp_execute` escape hatch** - When you need raw JS, it's there

## Requirements

- Node.js 18+
- Chrome/Chromium with `--remote-debugging-port` flag

## License

MIT
