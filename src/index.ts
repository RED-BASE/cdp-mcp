#!/usr/bin/env node

import { createClient, getClient, CDPClient } from './cdp-client';
import { launchBrowser, closeBrowser } from './browser-launcher';

// MCP protocol types
interface MCPRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: any;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

// Tool definitions
const tools: Tool[] = [
  {
    name: 'cdp_launch',
    description: 'Launch a Chrome/Chromium browser with CDP enabled. Creates a dedicated profile directory.',
    inputSchema: {
      type: 'object',
      properties: {
        port: { type: 'number', description: 'CDP debugging port (default: 9222)' },
        headless: { type: 'boolean', description: 'Run headless without visible window (default: false)' },
        browser: { type: 'string', description: 'Browser to use: chrome, chromium, edge, auto (default: auto)' },
        profile: { type: 'string', description: 'Profile name for isolated user data (default: cdp-mcp-default)' },
        width: { type: 'number', description: 'Window width (default: 1280)' },
        height: { type: 'number', description: 'Window height (default: 900)' },
        start_url: { type: 'string', description: 'URL to open on launch (default: about:blank)' },
      },
    },
  },
  {
    name: 'cdp_connect',
    description: 'Connect to an already-running Chrome/Chromium instance with CDP enabled.',
    inputSchema: {
      type: 'object',
      properties: {
        port: { type: 'number', description: 'CDP debugging port (default: 9222)' },
        host: { type: 'string', description: 'CDP host (default: localhost)' },
        tab: { type: 'number', description: 'Tab index to connect to (default: 0)' },
      },
    },
  },
  {
    name: 'cdp_list_tabs',
    description: 'List all open browser tabs.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'cdp_navigate',
    description: 'Navigate to a URL or perform navigation actions (back, forward, refresh).',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to' },
        action: { type: 'string', enum: ['back', 'forward', 'refresh'], description: 'Navigation action' },
        tab: { type: 'number', description: 'Tab index' },
      },
    },
  },
  {
    name: 'cdp_find_elements',
    description: 'Discover interactive elements on the page (inputs, buttons, links, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          enum: ['all', 'forms', 'inputs', 'buttons', 'links', 'media', 'custom'],
          description: 'Filter by element type (default: all)',
        },
        selector: { type: 'string', description: 'CSS selector to scope search' },
        include_hidden: { type: 'boolean', description: 'Include hidden elements (default: false)' },
      },
    },
  },
  {
    name: 'cdp_interact',
    description: 'Interact with elements: click, type, upload files, select options, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['click', 'dblclick', 'type', 'clear', 'select', 'check', 'uncheck', 'upload', 'focus', 'blur', 'hover', 'press', 'submit'],
          description: 'Action to perform',
        },
        selector: { type: 'string', description: 'CSS selector for target element' },
        value: { type: 'string', description: 'Value for type/select actions' },
        file_path: { type: 'string', description: 'File path for upload action' },
        key: { type: 'string', description: 'Key for press action (e.g., Enter, Tab)' },
        delay: { type: 'number', description: 'Delay between keystrokes in ms' },
      },
      required: ['action', 'selector'],
    },
  },
  {
    name: 'cdp_read',
    description: 'Read content from the page: full page text, element text, attributes.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          enum: ['page', 'element', 'attribute', 'value'],
          description: 'What to read (default: page)',
        },
        selector: { type: 'string', description: 'CSS selector for element' },
        attribute: { type: 'string', description: 'Attribute name to read' },
      },
    },
  },
  {
    name: 'cdp_screenshot',
    description: 'Capture a screenshot of the page or a specific element.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Element to capture (full page if omitted)' },
        format: { type: 'string', enum: ['png', 'jpeg', 'webp'], description: 'Image format (default: png)' },
        quality: { type: 'number', description: 'JPEG/WebP quality 0-100' },
        full_page: { type: 'boolean', description: 'Capture full scrollable page' },
        path: { type: 'string', description: 'Save to file path' },
      },
    },
  },
  {
    name: 'cdp_wait',
    description: 'Wait for conditions: element visible, text contains, navigation, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        condition: {
          type: 'string',
          enum: ['element_visible', 'element_hidden', 'element_exists', 'text_contains', 'value_equals', 'navigation'],
          description: 'Condition to wait for',
        },
        selector: { type: 'string', description: 'CSS selector for element conditions' },
        value: { type: 'string', description: 'Value to match' },
        timeout: { type: 'number', description: 'Timeout in ms (default: 30000)' },
      },
      required: ['condition'],
    },
  },
  {
    name: 'cdp_execute',
    description: 'Execute JavaScript in the page context.',
    inputSchema: {
      type: 'object',
      properties: {
        script: { type: 'string', description: 'JavaScript to execute' },
      },
      required: ['script'],
    },
  },
];

// Tool handlers
async function handleTool(name: string, args: any): Promise<any> {
  const client = getClient();

  switch (name) {
    case 'cdp_launch': {
      const result = await launchBrowser({
        port: args.port,
        headless: args.headless,
        browser: args.browser,
        profile: args.profile,
        width: args.width,
        height: args.height,
        startUrl: args.start_url,
      });

      if (result.launched) {
        // Auto-connect after launch
        const newClient = createClient(args.port || 9222);
        await newClient.connect();
      }

      return result;
    }

    case 'cdp_connect': {
      const newClient = createClient(args.port || 9222, args.host || 'localhost');
      const result = await newClient.connect(args.tab || 0);
      return result;
    }

    case 'cdp_list_tabs': {
      if (!client) {
        return { error: 'Not connected. Use cdp_launch or cdp_connect first.' };
      }
      const tabs = await client.listTabs();
      return {
        tabs: tabs.map((t, i) => ({
          index: i,
          title: t.title,
          url: t.url,
        })),
      };
    }

    case 'cdp_navigate': {
      if (!client) {
        return { error: 'Not connected. Use cdp_launch or cdp_connect first.' };
      }

      if (args.action === 'back') {
        await client.evaluate('history.back()');
        return { action: 'back', success: true };
      } else if (args.action === 'forward') {
        await client.evaluate('history.forward()');
        return { action: 'forward', success: true };
      } else if (args.action === 'refresh') {
        await client.evaluate('location.reload()');
        return { action: 'refresh', success: true };
      } else if (args.url) {
        const result = await client.navigate(args.url);
        return result;
      }

      return { error: 'Provide url or action' };
    }

    case 'cdp_find_elements': {
      if (!client) {
        return { error: 'Not connected. Use cdp_launch or cdp_connect first.' };
      }

      const filter = args.filter || 'all';
      const scopeSelector = args.selector || 'body';
      const includeHidden = args.include_hidden || false;

      // Build selector based on filter
      let selectors: string[] = [];
      switch (filter) {
        case 'inputs':
          selectors = ['input', 'textarea', 'select'];
          break;
        case 'buttons':
          selectors = ['button', 'input[type="submit"]', 'input[type="button"]', '[role="button"]'];
          break;
        case 'links':
          selectors = ['a[href]', '[role="link"]'];
          break;
        case 'forms':
          selectors = ['form'];
          break;
        case 'media':
          selectors = ['video', 'audio', 'img'];
          break;
        case 'custom':
          selectors = ['[onclick]', '[tabindex]', '[role]', '[contenteditable="true"]'];
          break;
        default: // 'all'
          selectors = [
            'input', 'textarea', 'select', 'button',
            'a[href]', '[role="button"]', '[role="link"]', '[role="checkbox"]',
            '[role="radio"]', '[role="textbox"]', '[role="combobox"]',
            '[tabindex]:not([tabindex="-1"])', '[contenteditable="true"]',
            'summary', 'details', 'video', 'audio',
          ];
      }

      const script = `
        (function() {
          const scope = document.querySelector('${scopeSelector.replace(/'/g, "\\'")}') || document.body;
          const selectors = ${JSON.stringify(selectors)};
          const includeHidden = ${includeHidden};

          const elements = [];
          const seen = new Set();

          selectors.forEach(sel => {
            scope.querySelectorAll(sel).forEach(el => {
              if (seen.has(el)) return;
              seen.add(el);

              const rect = el.getBoundingClientRect();
              const isVisible = rect.width > 0 && rect.height > 0 &&
                getComputedStyle(el).visibility !== 'hidden' &&
                getComputedStyle(el).display !== 'none';

              if (!includeHidden && !isVisible) return;

              const info = {
                tag: el.tagName.toLowerCase(),
                type: el.type || null,
                id: el.id || null,
                name: el.name || null,
                className: el.className || null,
                role: el.getAttribute('role'),
                label: null,
                placeholder: el.placeholder || null,
                value: el.value || null,
                text: el.textContent?.trim().slice(0, 100) || null,
                href: el.href || null,
                checked: el.checked,
                disabled: el.disabled,
                required: el.required,
                visible: isVisible,
                rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              };

              // Try to find label
              if (el.id) {
                const label = document.querySelector('label[for="' + el.id + '"]');
                if (label) info.label = label.textContent?.trim();
              }
              if (!info.label && el.closest('label')) {
                info.label = el.closest('label').textContent?.trim();
              }
              if (!info.label) {
                info.label = el.getAttribute('aria-label');
              }

              // Build selector
              if (el.id) {
                info.selector = '#' + el.id;
              } else if (el.name) {
                info.selector = el.tagName.toLowerCase() + '[name="' + el.name + '"]';
              } else if (el.className && typeof el.className === 'string') {
                const classes = el.className.split(' ').filter(c => c).slice(0, 2).join('.');
                info.selector = el.tagName.toLowerCase() + (classes ? '.' + classes : '');
              } else {
                info.selector = el.tagName.toLowerCase();
              }

              elements.push(info);
            });
          });

          return JSON.stringify(elements);
        })()
      `;

      const result = await client.evaluate(script);
      const elements = JSON.parse(result);

      // Add index to each element
      elements.forEach((el: any, i: number) => {
        el.index = i;
      });

      return {
        elements,
        summary: {
          total: elements.length,
          inputs: elements.filter((e: any) => ['input', 'textarea', 'select'].includes(e.tag)).length,
          buttons: elements.filter((e: any) => e.tag === 'button' || e.type === 'submit' || e.role === 'button').length,
          links: elements.filter((e: any) => e.tag === 'a' || e.role === 'link').length,
        },
      };
    }

    case 'cdp_interact': {
      if (!client) {
        return { error: 'Not connected. Use cdp_launch or cdp_connect first.' };
      }

      const { action, selector, value, file_path, key, delay } = args;

      switch (action) {
        case 'click':
          // Scroll element into view first
          await client.evaluate(`
            const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
            if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' });
          `);
          const clicked = await client.click(selector);
          return { success: clicked, action: 'click', selector };

        case 'dblclick':
          // Double click by clicking twice
          await client.click(selector);
          await client.click(selector);
          return { success: true, action: 'dblclick', selector };

        case 'type':
          if (!value) return { error: 'value required for type action' };

          // Scroll element into view first
          await client.evaluate(`
            const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
            if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' });
          `);

          const typed = await client.type(selector, value, { delay: delay || 0, clear: true });

          // Verify the value was actually set
          const actualValue = await client.evaluate(`
            document.querySelector('${selector.replace(/'/g, "\\'")}')?.value || null
          `);
          const verified = actualValue === value;

          return {
            success: typed && verified,
            action: 'type',
            selector,
            expected: value,
            actual: actualValue,
            verified
          };

        case 'clear':
          await client.evaluate(`
            const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
            if (el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
          `);
          return { success: true, action: 'clear', selector };

        case 'select':
          if (!value) return { error: 'value required for select action' };
          await client.evaluate(`
            const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
            if (el) {
              el.value = '${value.replace(/'/g, "\\'")}';
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
          `);
          const selectedValue = await client.evaluate(`
            document.querySelector('${selector.replace(/'/g, "\\'")}')?.value || null
          `);
          return {
            success: selectedValue === value,
            action: 'select',
            selector,
            expected: value,
            actual: selectedValue,
            verified: selectedValue === value
          };

        case 'check':
          await client.evaluate(`
            const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
            if (el && !el.checked) el.click();
          `);
          const checkedState = await client.evaluate(`
            document.querySelector('${selector.replace(/'/g, "\\'")}')?.checked ?? null
          `);
          return { success: checkedState === true, action: 'check', selector, checked: checkedState };

        case 'uncheck':
          await client.evaluate(`
            const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
            if (el && el.checked) el.click();
          `);
          const uncheckedState = await client.evaluate(`
            document.querySelector('${selector.replace(/'/g, "\\'")}')?.checked ?? null
          `);
          return { success: uncheckedState === false, action: 'uncheck', selector, checked: uncheckedState };

        case 'upload':
          if (!file_path) return { error: 'file_path required for upload action' };
          const uploaded = await client.uploadFile(selector, file_path);
          // Verify by checking the files property
          const uploadedFiles = await client.evaluate(`
            const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
            el?.files ? Array.from(el.files).map(f => f.name) : []
          `);
          return {
            success: uploaded && uploadedFiles.length > 0,
            action: 'upload',
            selector,
            file_path,
            uploaded_files: uploadedFiles
          };

        case 'focus':
          await client.evaluate(`document.querySelector('${selector.replace(/'/g, "\\'")}')?.focus()`);
          return { success: true, action: 'focus', selector };

        case 'blur':
          await client.evaluate(`document.querySelector('${selector.replace(/'/g, "\\'")}')?.blur()`);
          return { success: true, action: 'blur', selector };

        case 'hover':
          // Dispatch mouseover event
          await client.evaluate(`
            const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
            if (el) el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
          `);
          return { success: true, action: 'hover', selector };

        case 'press':
          if (!key) return { error: 'key required for press action' };
          await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key });
          await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key });
          return { success: true, action: 'press', key };

        case 'submit':
          await client.evaluate(`document.querySelector('${selector.replace(/'/g, "\\'")}')?.submit()`);
          return { success: true, action: 'submit', selector };

        default:
          return { error: `Unknown action: ${action}` };
      }
    }

    case 'cdp_read': {
      if (!client) {
        return { error: 'Not connected. Use cdp_launch or cdp_connect first.' };
      }

      const target = args.target || 'page';
      const selector = args.selector;
      const attribute = args.attribute;

      switch (target) {
        case 'page':
          const pageInfo = await client.evaluate(`
            JSON.stringify({
              url: document.URL,
              title: document.title,
              text: document.body.innerText.slice(0, 10000),
            })
          `);
          return JSON.parse(pageInfo);

        case 'element':
          if (!selector) return { error: 'selector required for element target' };
          const elementText = await client.evaluate(`
            document.querySelector('${selector.replace(/'/g, "\\'")}')?.innerText || null
          `);
          return { selector, text: elementText };

        case 'attribute':
          if (!selector || !attribute) return { error: 'selector and attribute required' };
          const attrValue = await client.evaluate(`
            document.querySelector('${selector.replace(/'/g, "\\'")}')?.getAttribute('${attribute}')
          `);
          return { selector, attribute, value: attrValue };

        case 'value':
          if (!selector) return { error: 'selector required for value target' };
          const inputValue = await client.evaluate(`
            document.querySelector('${selector.replace(/'/g, "\\'")}')?.value || null
          `);
          return { selector, value: inputValue };

        default:
          return { error: `Unknown target: ${target}` };
      }
    }

    case 'cdp_screenshot': {
      if (!client) {
        return { error: 'Not connected. Use cdp_launch or cdp_connect first.' };
      }

      const format = args.format || 'png';
      const quality = args.quality || 80;
      const fullPage = args.full_page || false;
      const path = args.path;

      const base64 = await client.screenshot({ format, quality, fullPage });

      if (path) {
        const fs = await import('fs');
        fs.writeFileSync(path, Buffer.from(base64, 'base64'));
        return { success: true, path, format };
      }

      return { format, base64: base64.slice(0, 100) + '...' }; // Truncate for display
    }

    case 'cdp_wait': {
      if (!client) {
        return { error: 'Not connected. Use cdp_launch or cdp_connect first.' };
      }

      const { condition, selector, value, timeout = 30000 } = args;
      const start = Date.now();

      while (Date.now() - start < timeout) {
        let met = false;

        switch (condition) {
          case 'element_visible':
            if (!selector) return { error: 'selector required' };
            met = await client.evaluate(`
              const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
              el && el.getBoundingClientRect().width > 0
            `);
            break;

          case 'element_hidden':
            if (!selector) return { error: 'selector required' };
            met = await client.evaluate(`
              const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
              !el || el.getBoundingClientRect().width === 0
            `);
            break;

          case 'element_exists':
            if (!selector) return { error: 'selector required' };
            met = await client.evaluate(`
              !!document.querySelector('${selector.replace(/'/g, "\\'")}')
            `);
            break;

          case 'text_contains':
            if (!value) return { error: 'value required' };
            const searchIn = selector || 'body';
            met = await client.evaluate(`
              document.querySelector('${searchIn.replace(/'/g, "\\'")}')?.innerText?.includes('${value.replace(/'/g, "\\'")}') || false
            `);
            break;

          case 'value_equals':
            if (!selector || !value) return { error: 'selector and value required' };
            met = await client.evaluate(`
              document.querySelector('${selector.replace(/'/g, "\\'")}')?.value === '${value.replace(/'/g, "\\'")}'
            `);
            break;

          case 'navigation':
            // Just wait a bit for navigation
            await new Promise(r => setTimeout(r, 1000));
            met = true;
            break;
        }

        if (met) {
          return { success: true, condition, waited_ms: Date.now() - start };
        }

        await new Promise(r => setTimeout(r, 200));
      }

      return { success: false, condition, error: 'Timeout', waited_ms: timeout };
    }

    case 'cdp_execute': {
      if (!client) {
        return { error: 'Not connected. Use cdp_launch or cdp_connect first.' };
      }

      try {
        const result = await client.evaluate(args.script);
        return { success: true, result };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// MCP server implementation
class MCPServer {
  private readline: any;

  async start() {
    const readline = await import('readline');
    this.readline = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    this.readline.on('line', async (line: string) => {
      try {
        const request: MCPRequest = JSON.parse(line);
        const response = await this.handleRequest(request);
        console.log(JSON.stringify(response));
      } catch (error) {
        console.log(JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        }));
      }
    });
  }

  async handleRequest(request: MCPRequest): Promise<MCPResponse> {
    const { id, method, params } = request;

    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'cdp-mcp',
              version: '0.1.0',
            },
          },
        };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: { tools },
        };

      case 'tools/call':
        const { name, arguments: args } = params;
        try {
          const result = await handleTool(name, args || {});
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            },
          };
        } catch (error) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }],
              isError: true,
            },
          };
        }

      case 'notifications/initialized':
        // No response needed for notifications
        return { jsonrpc: '2.0', id, result: {} };

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        };
    }
  }
}

// Start server
const server = new MCPServer();
server.start();
