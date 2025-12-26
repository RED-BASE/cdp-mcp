#!/usr/bin/env node

import { createClient, getClient, CDPClient } from './cdp-client';
import { launchBrowser, closeBrowser } from './browser-launcher';
import {
  shouldScan,
  getSiteInfo,
  storeSiteInfo,
  clearSiteInfo,
  listSites,
  addSiteNote,
  addSiteSelector,
  wasScannedThisEpoch,
  markScannedThisEpoch,
  getEpochInfo,
} from './site-memory';
import {
  trackBug,
  getBugs,
  getBug,
  fixBug,
  getBugsFilePath,
} from './bugs';

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
        text_filter: { type: 'string', description: 'Only return elements containing this text (case-insensitive)' },
        exclude_text: { type: 'string', description: 'Exclude elements containing this text (e.g., "Apply Now" to filter out job apply buttons)' },
        limit: { type: 'number', description: 'Max elements to return (default: 50)' },
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
        selector: { type: 'string', description: 'CSS selector OR text= prefix to find by text (e.g., "text=Submit", "text=Expand all")' },
        value: { type: 'string', description: 'Value for type/select actions' },
        file_path: { type: 'string', description: 'File path for upload action' },
        trigger_selector: { type: 'string', description: 'CSS selector for button to click before upload (for hidden file inputs)' },
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
        frame_id: { type: 'string', description: 'Execute in specific frame (from cdp_list_frames)' },
      },
      required: ['script'],
    },
  },
  {
    name: 'cdp_list_frames',
    description: 'List all frames on the page (main frame + iframes). Use this to find iframes for LinkedIn Easy Apply, Gmail compose, etc.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'cdp_frame_interact',
    description: 'Interact with elements inside iframes. Automatically searches all frames for the element.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['click', 'type', 'find', 'read'],
          description: 'Action to perform',
        },
        selector: { type: 'string', description: 'CSS selector for the element' },
        value: { type: 'string', description: 'Value for type action' },
        frame_id: { type: 'string', description: 'Specific frame ID (optional - will search all frames if not provided)' },
      },
      required: ['action', 'selector'],
    },
  },
  {
    name: 'cdp_type_text',
    description: 'Type text at the current cursor position using CDP Input.insertText. This simulates real keyboard input and works with React/Vue/Angular controlled inputs. Focus an element first with cdp_interact focus action.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to type' },
        delay: { type: 'number', description: 'Delay between characters in ms (default: 0)' },
        press_enter: { type: 'boolean', description: 'Press Enter after typing (default: false)' },
        press_tab: { type: 'boolean', description: 'Press Tab after typing to move to next field (default: false)' },
      },
      required: ['text'],
    },
  },
  {
    name: 'cdp_click_coordinates',
    description: 'Click at raw x,y screen coordinates. Useful for clicking elements in shadow DOM or other hard-to-select elements. Get coordinates from screenshots or cdp_find_elements rect values.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate' },
        y: { type: 'number', description: 'Y coordinate' },
        click_count: { type: 'number', description: 'Number of clicks (1=single, 2=double, default: 1)' },
        button: { type: 'string', description: 'Mouse button: left, right, middle (default: left)', enum: ['left', 'right', 'middle'] },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'cdp_upload_shadow',
    description: 'Upload a file to a file input in shadow DOM. First use cdp_execute to find the file input and store it in window.__fileInput, then call this tool.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file to upload' },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'cdp_set_value',
    description: 'Set the value of an input/textarea, properly handling React/Vue/Angular controlled inputs. This clears existing content and sets new value, triggering all necessary events. Best for form fields that cdp_interact type struggles with.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the input/textarea' },
        value: { type: 'string', description: 'Value to set' },
        clear_first: { type: 'boolean', description: 'Clear existing value first (default: true)' },
      },
      required: ['selector', 'value'],
    },
  },
  {
    name: 'cdp_monaco_editor',
    description: 'Interact with Monaco Editor (VS Code web editor) on the page. Detects Monaco instances and provides reliable get/set operations that preserve formatting. Much better than generic text input tools for Monaco.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['detect', 'getValue', 'setValue', 'clear'],
          description: 'Action: detect (find editors), getValue (read code), setValue (write code), clear (empty editor)',
        },
        value: { type: 'string', description: 'Code to set (required for setValue action)' },
        editor_index: { type: 'number', description: 'Editor index to target when multiple Monaco editors exist (default: 0)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'cdp_submit_form',
    description: 'Submit a form reliably, with special handling for React/Vue/Angular. Tries multiple submission methods: requestSubmit(), clicking submit button, dispatching submit event, and direct submit(). Works when Enter key fails.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the form. If omitted, finds form from focused element or first form on page.' },
      },
    },
  },
  // Site Memory Tools
  {
    name: 'cdp_site_scan',
    description: 'Scan current page structure and store in site memory. Detects iframes, shadow DOM, forms, and key elements. Automatically skips if already scanned this conversation epoch (compaction resets this). Use force=true to rescan anyway.',
    inputSchema: {
      type: 'object',
      properties: {
        force: { type: 'boolean', description: 'Force rescan even if already scanned this epoch (default: false)' },
        note: { type: 'string', description: 'Optional note to add to site memory' },
      },
    },
  },
  {
    name: 'cdp_site_info',
    description: 'Get stored site memory for the current page or a specific domain. Returns iframe locations, shadow DOM elements, and interaction patterns learned from previous visits.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Domain to look up (uses current page if not specified)' },
      },
    },
  },
  {
    name: 'cdp_site_note',
    description: 'Add a note or selector pattern to site memory. Use this to record what you learned about interacting with a site.',
    inputSchema: {
      type: 'object',
      properties: {
        note: { type: 'string', description: 'Note to add (e.g., "Easy Apply modal is an iframe")' },
        selector_name: { type: 'string', description: 'Name for a selector pattern (e.g., "apply_button")' },
        selector: { type: 'string', description: 'CSS selector to remember' },
      },
    },
  },
  {
    name: 'cdp_site_list',
    description: 'List all sites in memory with their key info.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'cdp_site_clear',
    description: 'Clear site memory for a domain (forces fresh scan next time).',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Domain to clear (uses current page if not specified)' },
      },
    },
  },
  {
    name: 'cdp_epoch_info',
    description: 'Get current epoch info. Useful for debugging site memory behavior.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  // Bug Tracking Tools
  {
    name: 'cdp_track_bug',
    description: 'Track a bug in the CDP-MCP. Writes to BUGS.md in the cdp-mcp folder. Use this when you encounter issues with browser automation.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short bug title' },
        description: { type: 'string', description: 'Detailed description of the bug' },
        context: { type: 'string', description: 'Optional context (e.g., which site, what action)' },
      },
      required: ['title', 'description'],
    },
  },
  {
    name: 'cdp_list_bugs',
    description: 'List all tracked bugs in CDP-MCP.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'cdp_fix_bug',
    description: 'Mark a bug as fixed and remove it from the tracking file.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Bug ID to mark as fixed' },
      },
      required: ['id'],
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
      const textFilter = args.text_filter || null;
      const excludeText = args.exclude_text || null;
      const limit = args.limit || 50;

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
          const textFilter = ${textFilter ? JSON.stringify(textFilter.toLowerCase()) : 'null'};
          const excludeText = ${excludeText ? JSON.stringify(excludeText.toLowerCase()) : 'null'};
          const limit = ${limit};

          const elements = [];
          const seen = new Set();

          selectors.forEach(sel => {
            if (elements.length >= limit) return;
            scope.querySelectorAll(sel).forEach(el => {
              if (elements.length >= limit) return;
              if (seen.has(el)) return;
              seen.add(el);

              const rect = el.getBoundingClientRect();
              const isVisible = rect.width > 0 && rect.height > 0 &&
                getComputedStyle(el).visibility !== 'hidden' &&
                getComputedStyle(el).display !== 'none';

              if (!includeHidden && !isVisible) return;

              // Get text content for filtering
              const fullText = (el.textContent?.trim() || el.value || el.getAttribute('aria-label') || '').toLowerCase();

              // Apply text filters
              if (textFilter && !fullText.includes(textFilter)) return;
              if (excludeText && fullText.includes(excludeText)) return;

              const cap = (s, len = 80) => s && s.length > len ? s.slice(0, len) + '...' : s;
              const info = {
                tag: el.tagName.toLowerCase(),
                type: el.type || null,
                id: cap(el.id, 60) || null,
                name: cap(el.name, 40) || null,
                className: cap(el.className, 60) || null,
                role: el.getAttribute('role'),
                label: null,
                placeholder: cap(el.placeholder, 40) || null,
                value: cap(el.value, 40) || null,
                text: cap(el.textContent?.trim(), 60) || null,
                href: cap(el.href, 80) || null,
                disabled: el.disabled,
                visible: isVisible,
                rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
              };

              // Try to find label
              if (el.id) {
                const label = document.querySelector('label[for="' + el.id + '"]');
                if (label) info.label = cap(label.textContent?.trim(), 60);
              }
              if (!info.label && el.closest('label')) {
                info.label = cap(el.closest('label').textContent?.trim(), 60);
              }
              if (!info.label) {
                info.label = cap(el.getAttribute('aria-label'), 60);
              }

              // Build selector (keep short for usability)
              if (el.id) {
                info.selector = '#' + (el.id.length > 50 ? el.id.slice(0, 50) : el.id);
              } else if (el.name) {
                info.selector = el.tagName.toLowerCase() + '[name="' + el.name.slice(0, 30) + '"]';
              } else if (el.className && typeof el.className === 'string') {
                const classes = el.className.split(' ').filter(c => c && c.length < 30).slice(0, 2).join('.');
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
          limit_applied: limit,
          text_filter: textFilter,
          exclude_text: excludeText,
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

      const { action, value, file_path, key, delay } = args;
      let { selector } = args;

      // Support text= prefix for finding elements by text content
      // Example: text=Expand all, text=Submit, text=/regex/i
      // When using text=, we find and interact with the element directly (no selector generation)
      const isTextSelector = selector?.startsWith('text=');
      let textQuery: string | null = null;
      let isRegex = false;

      if (isTextSelector) {
        textQuery = selector!.slice(5); // Remove 'text=' prefix
        isRegex = textQuery!.startsWith('/') && (textQuery!.endsWith('/') || textQuery!.endsWith('/i'));
      }

      switch (action) {
        case 'click':
          // Handle text= selector by finding and clicking directly
          if (isTextSelector && textQuery) {
            const textClicked = await client.evaluate(`
              (() => {
                const textQuery = ${JSON.stringify(textQuery)};
                const isRegex = ${isRegex};
                const clickable = [...document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"], [onclick], summary')];

                for (const el of clickable) {
                  const text = el.textContent?.trim() || el.value || el.getAttribute('aria-label') || '';
                  let matches = false;
                  if (isRegex) {
                    const flags = textQuery.endsWith('/i') ? 'i' : '';
                    const pattern = textQuery.slice(1, flags ? -2 : -1);
                    matches = new RegExp(pattern, flags).test(text);
                  } else {
                    matches = text.toLowerCase().includes(textQuery.toLowerCase());
                  }

                  if (matches) {
                    el.scrollIntoView({ block: 'center', behavior: 'instant' });
                    el.click();
                    return { success: true, text: text.slice(0, 50) };
                  }
                }
                return { success: false, error: 'No element found with text: ' + textQuery };
              })()
            `);

            if (textClicked?.success) {
              return { success: true, action: 'click', selector, method: 'text', matched: textClicked.text };
            }
            return { error: textClicked?.error || 'Text selector failed', selector };
          }

          // Scroll element into view first
          await client.evaluate(`
            const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
            if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' });
          `);

          // Try JS click first (works better for React/JS-heavy sites)
          const jsClicked = await client.evaluate(`
            (() => {
              const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
              if (!el) return { success: false, error: 'Element not found' };

              // Don't use JS click for file inputs (security restriction)
              if (el.tagName === 'INPUT' && el.type === 'file') {
                return { success: false, error: 'File input requires coordinate click' };
              }

              el.click();
              return { success: true };
            })()
          `);

          if (jsClicked?.success) {
            return { success: true, action: 'click', selector, method: 'js' };
          }

          // Fall back to coordinate-based click
          const clicked = await client.click(selector);
          return { success: clicked, action: 'click', selector, method: 'coordinates', fallback_reason: jsClicked?.error };

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

          // Try JS approach first (works better for React/JS-heavy sites)
          // Use native setter to bypass React's controlled input handling
          const jsTyped = await client.evaluate(`
            (() => {
              const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
              if (!el) return { success: false, error: 'Element not found' };

              el.focus();

              // Use native setter to bypass React's value control
              const tagName = el.tagName.toLowerCase();
              const proto = tagName === 'textarea'
                ? window.HTMLTextAreaElement.prototype
                : window.HTMLInputElement.prototype;
              const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

              if (nativeSetter) {
                nativeSetter.call(el, '${value.replace(/'/g, "\\'")}');
              } else {
                el.value = '${value.replace(/'/g, "\\'")}';
              }

              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return { success: true, value: el.value };
            })()
          `);

          if (jsTyped?.success) {
            return { success: true, action: 'type', selector, method: 'js', value: jsTyped.value, verified: true };
          }

          // Fall back to CDP type method
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
            method: 'cdp',
            fallback_reason: jsTyped?.error,
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

          // Enhanced upload: handle hidden file inputs with trigger buttons
          // First, check if the file input exists
          let fileInputExists = await client.evaluate(`
            !!document.querySelector('${selector.replace(/'/g, "\\'")}')
          `);

          // If file input doesn't exist and we have a trigger, click it first
          if (!fileInputExists && args.trigger_selector) {
            await client.evaluate(`
              const trigger = document.querySelector('${args.trigger_selector.replace(/'/g, "\\'")}');
              if (trigger) trigger.click();
            `);
            // Wait for file input to appear
            for (let i = 0; i < 20; i++) {
              await new Promise(r => setTimeout(r, 100));
              fileInputExists = await client.evaluate(`
                !!document.querySelector('${selector.replace(/'/g, "\\'")}')
              `);
              if (fileInputExists) break;
            }
          }

          // If still no file input, try to find any file input on the page
          if (!fileInputExists) {
            const anyFileInput = await client.evaluate(`
              const inputs = document.querySelectorAll('input[type="file"]');
              inputs.length > 0 ? (inputs[0].id || inputs[0].name || 'input[type="file"]') : null
            `);
            if (anyFileInput) {
              // Use the found file input
              const actualSelector = anyFileInput.startsWith('input') ? anyFileInput : `#${anyFileInput}`;
              const uploaded = await client.uploadFile(actualSelector, file_path);
              const uploadedFiles = await client.evaluate(`
                const el = document.querySelector('${actualSelector.replace(/'/g, "\\'")}');
                el?.files ? Array.from(el.files).map(f => f.name) : []
              `);
              return {
                success: uploaded && uploadedFiles.length > 0,
                action: 'upload',
                selector: actualSelector,
                file_path,
                uploaded_files: uploadedFiles,
                note: 'Used auto-detected file input'
              };
            }
          }

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
        let result;
        if (args.frame_id) {
          result = await client.evaluateInFrame(args.frame_id, args.script);
        } else {
          result = await client.evaluate(args.script);
        }
        return { success: true, result };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    case 'cdp_list_frames': {
      if (!client) {
        return { error: 'Not connected. Use cdp_launch or cdp_connect first.' };
      }

      try {
        const frames = await client.listFrames();
        return {
          frames,
          total: frames.length,
          main_frame: frames.find(f => f.isMain)?.id || null,
          iframes: frames.filter(f => !f.isMain).length,
        };
      } catch (error) {
        return { error: String(error) };
      }
    }

    case 'cdp_frame_interact': {
      if (!client) {
        return { error: 'Not connected. Use cdp_launch or cdp_connect first.' };
      }

      const { action, selector, value, frame_id } = args;

      try {
        let targetFrameId = frame_id;

        // If no frame specified, search all frames
        if (!targetFrameId) {
          const found = await client.findElementInFrames(selector);
          if (!found) {
            return { error: `Element not found in any frame: ${selector}` };
          }
          targetFrameId = found.frameId;
        }

        switch (action) {
          case 'find': {
            const frames = await client.listFrames();
            const results: Array<{ frameId: string; url: string; found: boolean }> = [];

            for (const frame of frames) {
              try {
                const found = await client.evaluateInFrame(frame.id, `
                  !!document.querySelector('${selector.replace(/'/g, "\\'")}')
                `);
                if (found) {
                  results.push({ frameId: frame.id, url: frame.url, found: true });
                }
              } catch {
                // Skip inaccessible frames
              }
            }

            return {
              selector,
              found_in_frames: results,
              total_matches: results.length,
            };
          }

          case 'click': {
            const success = await client.clickInFrame(targetFrameId, selector);
            return { success, action: 'click', selector, frame_id: targetFrameId };
          }

          case 'type': {
            if (!value) return { error: 'value required for type action' };
            const success = await client.typeInFrame(targetFrameId, selector, value);
            return { success, action: 'type', selector, value, frame_id: targetFrameId };
          }

          case 'read': {
            const text = await client.evaluateInFrame(targetFrameId, `
              document.querySelector('${selector.replace(/'/g, "\\'")}')?.innerText ||
              document.querySelector('${selector.replace(/'/g, "\\'")}')?.value || null
            `);
            return { selector, frame_id: targetFrameId, text };
          }

          default:
            return { error: `Unknown action: ${action}` };
        }
      } catch (error) {
        return { error: String(error) };
      }
    }

    case 'cdp_type_text': {
      if (!client) {
        return { error: 'Not connected. Use cdp_launch or cdp_connect first.' };
      }

      const { text, delay = 0, press_enter = false, press_tab = false } = args;

      try {
        let success: boolean;
        if (delay > 0) {
          success = await client.typeText(text, delay);
        } else {
          success = await client.insertText(text);
        }

        let enterResult: any = null;
        if (press_enter) {
          // Try CDP Enter key first (improved with proper key codes)
          await client.pressKey('Enter');

          // Also try submitForm as fallback for React forms
          // Small delay to let Enter key take effect first
          await new Promise(r => setTimeout(r, 50));
          enterResult = await client.submitForm();
        }
        if (press_tab) {
          await client.pressKey('Tab');
        }

        return {
          success,
          text,
          delay,
          pressed_enter: press_enter,
          pressed_tab: press_tab,
          form_submit: enterResult,
        };
      } catch (error) {
        return { error: String(error) };
      }
    }

    case 'cdp_click_coordinates': {
      if (!client) {
        return { error: 'Not connected. Use cdp_launch or cdp_connect first.' };
      }

      const { x, y, click_count = 1, button = 'left' } = args;

      try {
        const success = await client.clickAtCoordinates(x, y, { clickCount: click_count, button });
        return { success, x, y, click_count, button };
      } catch (error) {
        return { error: String(error) };
      }
    }

    case 'cdp_upload_shadow': {
      if (!client) {
        return { error: 'Not connected. Use cdp_launch or cdp_connect first.' };
      }

      const { file_path } = args;

      try {
        const success = await client.uploadFileToShadowElement(file_path);
        return { success, file_path };
      } catch (error) {
        return { error: String(error) };
      }
    }

    case 'cdp_set_value': {
      if (!client) {
        return { error: 'Not connected. Use cdp_launch or cdp_connect first.' };
      }

      const { selector, value, clear_first = true } = args;

      try {
        // Comprehensive value setter that handles React/Vue/Angular
        const result = await client.evaluate(`
          (() => {
            const selector = ${JSON.stringify(selector)};
            const newValue = ${JSON.stringify(value)};
            const clearFirst = ${clear_first};

            const el = document.querySelector(selector);
            if (!el) return { success: false, error: 'Element not found: ' + selector };

            // Scroll into view and focus
            el.scrollIntoView({ block: 'center', behavior: 'instant' });
            el.focus();

            // Get the appropriate prototype for native setter
            const tagName = el.tagName.toLowerCase();
            const proto = tagName === 'textarea'
              ? window.HTMLTextAreaElement.prototype
              : tagName === 'select'
                ? window.HTMLSelectElement.prototype
                : window.HTMLInputElement.prototype;

            const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

            // Clear first if requested
            if (clearFirst && nativeSetter) {
              nativeSetter.call(el, '');
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }

            // Set the new value using native setter (bypasses React's controlled input)
            if (nativeSetter) {
              nativeSetter.call(el, newValue);
            } else {
              el.value = newValue;
            }

            // Trigger React's onChange if present
            // React 16+ stores handlers in __reactProps$ or __reactFiber$
            const reactPropsKey = Object.keys(el).find(key => key.startsWith('__reactProps$'));
            if (reactPropsKey && el[reactPropsKey]?.onChange) {
              try {
                el[reactPropsKey].onChange({
                  target: el,
                  currentTarget: el,
                  type: 'change'
                });
              } catch (e) {
                // React handler might throw, that's ok
              }
            }

            // Also check for React Fiber (older pattern)
            const reactFiberKey = Object.keys(el).find(key => key.startsWith('__reactFiber$'));
            if (reactFiberKey) {
              // React Fiber found, events should propagate
            }

            // Dispatch standard DOM events (for non-React handlers and validation)
            el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

            // For good measure, also dispatch a keyboard event (some validators listen to this)
            el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

            // Blur and refocus to trigger any onBlur validation
            el.blur();
            el.focus();

            return {
              success: true,
              value: el.value,
              matched: el.value === newValue,
              tagName: tagName,
              hasReactProps: !!reactPropsKey
            };
          })()
        `);

        return result;
      } catch (error) {
        return { error: String(error) };
      }
    }

    case 'cdp_monaco_editor': {
      if (!client) {
        return { error: 'Not connected. Use cdp_launch or cdp_connect first.' };
      }

      const { action, value, editor_index = 0 } = args;

      try {
        const result = await client.monacoEditor(action, value, editor_index);
        return result;
      } catch (error) {
        return { error: String(error) };
      }
    }

    case 'cdp_submit_form': {
      if (!client) {
        return { error: 'Not connected. Use cdp_launch or cdp_connect first.' };
      }

      try {
        const result = await client.submitForm(args.selector);
        return result;
      } catch (error) {
        return { error: String(error) };
      }
    }

    // Site Memory Tools
    case 'cdp_site_scan': {
      if (!client) {
        return { error: 'Not connected. Use cdp_launch or cdp_connect first.' };
      }

      try {
        // Get current URL
        const pageInfo = await client.evaluate(`
          JSON.stringify({ url: document.URL, title: document.title })
        `);
        const { url } = JSON.parse(pageInfo);

        // Check if we should scan
        const scanDecision = shouldScan(url);
        if (!scanDecision.should_scan && !args.force) {
          return {
            skipped: true,
            reason: scanDecision.reason,
            cached_info: scanDecision.cached_info,
            hint: 'Use force=true to rescan anyway',
          };
        }

        // Scan for iframes
        const frames = await client.listFrames();
        const iframeNotes: string[] = [];
        for (const frame of frames) {
          if (!frame.isMain) {
            iframeNotes.push(`iframe: ${frame.url?.slice(0, 100) || 'unknown'}`);
          }
        }

        // Scan for shadow DOM and page structure
        const structureData = await client.evaluate(`
          (() => {
            const shadowHosts = [];
            const walk = (node) => {
              if (node.shadowRoot) {
                const tag = node.tagName?.toLowerCase() || 'unknown';
                const id = node.id ? '#' + node.id : '';
                const cls = node.className && typeof node.className === 'string'
                  ? '.' + node.className.split(' ')[0]
                  : '';
                shadowHosts.push(tag + id + cls);
              }
              if (node.children) {
                for (const child of node.children) walk(child);
              }
            };
            walk(document.body);

            return JSON.stringify({
              has_shadow_dom: shadowHosts.length > 0,
              shadow_dom_elements: shadowHosts.slice(0, 10),
              form_count: document.forms.length,
              input_count: document.querySelectorAll('input, textarea, select').length,
            });
          })()
        `);
        const structureParsed = JSON.parse(structureData);

        const structure = {
          has_iframes: frames.length > 1,
          has_shadow_dom: structureParsed.has_shadow_dom,
          iframe_count: frames.length - 1,
          iframe_notes: iframeNotes,
          shadow_dom_elements: structureParsed.shadow_dom_elements,
          form_count: structureParsed.form_count,
          input_count: structureParsed.input_count,
        };

        // Store the info
        const siteInfo = storeSiteInfo(url, structure);

        // Add optional note
        if (args.note) {
          addSiteNote(url, args.note);
        }

        return {
          scanned: true,
          url,
          domain: siteInfo.domain,
          structure,
          epoch: siteInfo.last_epoch,
          message: scanDecision.cached_info
            ? 'Rescanned (new epoch or forced)'
            : 'First scan of this site',
        };
      } catch (error) {
        return { error: String(error) };
      }
    }

    case 'cdp_site_info': {
      let url = args.domain;

      // If no domain specified and we're connected, use current page
      if (!url && client) {
        try {
          const pageInfo = await client.evaluate(`document.URL`);
          url = pageInfo;
        } catch {
          // Not connected or can't get URL
        }
      }

      if (!url) {
        return { error: 'No domain specified and not connected to a page' };
      }

      const info = getSiteInfo(url);
      if (!info) {
        return {
          found: false,
          domain: url,
          message: 'No stored info for this site. Use cdp_site_scan to scan it.',
        };
      }

      const scannedThisEpoch = wasScannedThisEpoch(url);
      return {
        found: true,
        scanned_this_epoch: scannedThisEpoch,
        ...info,
      };
    }

    case 'cdp_site_note': {
      let url: string | null = null;

      // Get current page URL if connected
      if (client) {
        try {
          url = await client.evaluate(`document.URL`);
        } catch {
          // Not connected
        }
      }

      if (!url) {
        return { error: 'Not connected to a page' };
      }

      const results: string[] = [];

      if (args.note) {
        const added = addSiteNote(url, args.note);
        results.push(added ? `Added note: ${args.note}` : 'Failed to add note (site not in memory)');
      }

      if (args.selector_name && args.selector) {
        const added = addSiteSelector(url, args.selector_name, args.selector);
        results.push(added ? `Added selector ${args.selector_name}: ${args.selector}` : 'Failed to add selector');
      }

      if (results.length === 0) {
        return { error: 'Provide note or selector_name+selector' };
      }

      return { success: true, results };
    }

    case 'cdp_site_list': {
      const sites = listSites();
      return {
        sites,
        total: sites.length,
      };
    }

    case 'cdp_site_clear': {
      let url = args.domain;

      // If no domain specified and we're connected, use current page
      if (!url && client) {
        try {
          url = await client.evaluate(`document.URL`);
        } catch {
          // Not connected
        }
      }

      if (!url) {
        return { error: 'No domain specified and not connected to a page' };
      }

      const cleared = clearSiteInfo(url);
      return {
        cleared,
        domain: url,
        message: cleared ? 'Site memory cleared' : 'No stored info for this site',
      };
    }

    case 'cdp_epoch_info': {
      const info = getEpochInfo();
      return {
        ...info,
        message: `Epoch ${info.epoch} (${info.summary_count} compactions in this session)`,
      };
    }

    // Bug Tracking Tools
    case 'cdp_track_bug': {
      const { title, description, context } = args;

      try {
        const bug = trackBug(title, description, context);
        return {
          tracked: true,
          bug,
          file: getBugsFilePath(),
          message: `Bug tracked: [${bug.id}] ${bug.title}`,
        };
      } catch (error) {
        return { error: String(error) };
      }
    }

    case 'cdp_list_bugs': {
      try {
        const bugs = getBugs();
        return {
          bugs,
          total: bugs.length,
          file: getBugsFilePath(),
          message: bugs.length === 0
            ? 'No bugs tracked'
            : `${bugs.length} bug(s) tracked`,
        };
      } catch (error) {
        return { error: String(error) };
      }
    }

    case 'cdp_fix_bug': {
      const { id } = args;

      try {
        const result = fixBug(id);
        if (result.removed) {
          return {
            fixed: true,
            bug: result.bug,
            message: `Bug fixed and removed: [${id}] ${result.bug?.title}`,
          };
        } else {
          return {
            fixed: false,
            message: `Bug not found: ${id}`,
          };
        }
      } catch (error) {
        return { error: String(error) };
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
