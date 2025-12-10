import WebSocket from 'ws';

interface CDPResponse {
  id: number;
  result?: any;
  error?: { code: number; message: string };
}

interface CDPEvent {
  method: string;
  params: any;
}

interface TabInfo {
  id: string;
  title: string;
  url: string;
  type: string;
  webSocketDebuggerUrl?: string;
}

export class CDPClient {
  private ws: WebSocket | null = null;
  private port: number;
  private host: string;
  private messageId: number = 1;
  private pendingMessages: Map<number, { resolve: Function; reject: Function }> = new Map();
  private eventHandlers: Map<string, Function[]> = new Map();
  private currentTabId: string | null = null;

  constructor(port: number = 9222, host: string = 'localhost') {
    this.port = port;
    this.host = host;
  }

  async connect(tabIndex: number = 0): Promise<{ connected: boolean; browser?: string; tabs?: number; error?: string }> {
    try {
      // Get browser version
      const versionResponse = await fetch(`http://${this.host}:${this.port}/json/version`);
      if (!versionResponse.ok) {
        return { connected: false, error: 'Could not connect to CDP endpoint' };
      }
      const versionData = await versionResponse.json() as { Browser?: string };

      // Get tabs
      const tabsResponse = await fetch(`http://${this.host}:${this.port}/json`);
      const tabs = await tabsResponse.json() as TabInfo[];

      const pageTabs = tabs.filter(t => t.type === 'page');
      if (pageTabs.length === 0) {
        return { connected: false, error: 'No page tabs available' };
      }

      const targetTab = pageTabs[Math.min(tabIndex, pageTabs.length - 1)];
      if (!targetTab.webSocketDebuggerUrl) {
        return { connected: false, error: 'Tab does not have WebSocket debugger URL' };
      }

      // Connect WebSocket
      await this.connectToTab(targetTab.webSocketDebuggerUrl);
      this.currentTabId = targetTab.id;

      // Enable required domains
      await this.send('Page.enable');
      await this.send('DOM.enable');
      await this.send('Runtime.enable');

      return {
        connected: true,
        browser: versionData.Browser,
        tabs: pageTabs.length,
      };
    } catch (error) {
      return { connected: false, error: String(error) };
    }
  }

  private connectToTab(wsUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => resolve());
      this.ws.on('error', (err) => reject(err));
      this.ws.on('close', () => {
        this.ws = null;
      });

      this.ws.on('message', (data) => {
        const message = JSON.parse(data.toString());

        if ('id' in message) {
          // Response to a command
          const pending = this.pendingMessages.get(message.id);
          if (pending) {
            this.pendingMessages.delete(message.id);
            if (message.error) {
              pending.reject(new Error(message.error.message));
            } else {
              pending.resolve(message.result);
            }
          }
        } else if ('method' in message) {
          // Event
          const handlers = this.eventHandlers.get(message.method);
          if (handlers) {
            handlers.forEach(h => h(message.params));
          }
        }
      });
    });
  }

  async send(method: string, params: any = {}): Promise<any> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to CDP');
    }

    const id = this.messageId++;
    const message = { id, method, params };

    return new Promise((resolve, reject) => {
      this.pendingMessages.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify(message));

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingMessages.has(id)) {
          this.pendingMessages.delete(id);
          reject(new Error(`CDP command ${method} timed out`));
        }
      }, 30000);
    });
  }

  on(event: string, handler: Function): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
  }

  async listTabs(): Promise<TabInfo[]> {
    const response = await fetch(`http://${this.host}:${this.port}/json`);
    const tabs = await response.json() as TabInfo[];
    return tabs.filter(t => t.type === 'page');
  }

  async switchTab(tabIndex: number): Promise<boolean> {
    const tabs = await this.listTabs();
    if (tabIndex >= tabs.length) return false;

    const tab = tabs[tabIndex];
    if (!tab.webSocketDebuggerUrl) return false;

    // Close current connection
    if (this.ws) {
      this.ws.close();
    }

    // Connect to new tab
    await this.connectToTab(tab.webSocketDebuggerUrl);
    this.currentTabId = tab.id;

    await this.send('Page.enable');
    await this.send('DOM.enable');
    await this.send('Runtime.enable');

    return true;
  }

  async navigate(url: string): Promise<{ url: string; title: string }> {
    await this.send('Page.navigate', { url });

    // Wait for load
    await new Promise<void>((resolve) => {
      const handler = () => {
        this.eventHandlers.delete('Page.loadEventFired');
        resolve();
      };
      this.on('Page.loadEventFired', handler);
      // Timeout fallback
      setTimeout(resolve, 10000);
    });

    // Get current URL and title
    const { result } = await this.send('Runtime.evaluate', {
      expression: 'JSON.stringify({ url: document.URL, title: document.title })',
      returnByValue: true,
    });

    return JSON.parse(result.value);
  }

  async evaluate(expression: string): Promise<any> {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });

    if (exceptionDetails) {
      throw new Error(exceptionDetails.text || 'Evaluation error');
    }

    return result.value;
  }

  async getDocument(): Promise<any> {
    const { root } = await this.send('DOM.getDocument', { depth: -1, pierce: true });
    return root;
  }

  async querySelector(selector: string): Promise<number | null> {
    const doc = await this.getDocument();
    try {
      const { nodeId } = await this.send('DOM.querySelector', {
        nodeId: doc.nodeId,
        selector,
      });
      return nodeId || null;
    } catch {
      return null;
    }
  }

  async querySelectorAll(selector: string): Promise<number[]> {
    const doc = await this.getDocument();
    try {
      const { nodeIds } = await this.send('DOM.querySelectorAll', {
        nodeId: doc.nodeId,
        selector,
      });
      return nodeIds || [];
    } catch {
      return [];
    }
  }

  async getBoxModel(nodeId: number): Promise<any> {
    try {
      const { model } = await this.send('DOM.getBoxModel', { nodeId });
      return model;
    } catch {
      return null;
    }
  }

  async click(selector: string): Promise<boolean> {
    const nodeId = await this.querySelector(selector);
    if (!nodeId) return false;

    const box = await this.getBoxModel(nodeId);
    if (!box) return false;

    const x = (box.content[0] + box.content[2]) / 2;
    const y = (box.content[1] + box.content[5]) / 2;

    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });

    return true;
  }

  async type(selector: string, text: string, options: { delay?: number; clear?: boolean } = {}): Promise<boolean> {
    const { delay = 0, clear = false } = options;

    // Focus the element and optionally clear it
    const focused = await this.evaluate(`
      (() => {
        const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (!el) return false;
        el.focus();
        ${clear ? "el.value = '';" : ''}
        return true;
      })()
    `);

    if (!focused) return false;

    if (delay > 0) {
      // Character-by-character typing with delay (for bot detection, debounce testing)
      for (const char of text) {
        await this.send('Input.dispatchKeyEvent', {
          type: 'char',
          text: char,
        });
        await new Promise(r => setTimeout(r, delay));
      }
    } else {
      // Fast path: insert all text at once
      await this.send('Input.insertText', { text });
    }

    // Dispatch input event so frameworks (React, Vue, etc.) react properly
    await this.evaluate(`
      (() => {
        const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (el) {
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()
    `);

    return true;
  }

  async uploadFile(selector: string, filePath: string): Promise<boolean> {
    const nodeId = await this.querySelector(selector);
    if (!nodeId) return false;

    await this.send('DOM.setFileInputFiles', {
      nodeId,
      files: [filePath],
    });

    return true;
  }

  async screenshot(options: { format?: string; quality?: number; fullPage?: boolean } = {}): Promise<string> {
    const { format = 'png', quality = 80, fullPage = false } = options;

    if (fullPage) {
      // Get full page dimensions
      const metrics = await this.send('Page.getLayoutMetrics');
      await this.send('Emulation.setDeviceMetricsOverride', {
        width: Math.ceil(metrics.contentSize.width),
        height: Math.ceil(metrics.contentSize.height),
        deviceScaleFactor: 1,
        mobile: false,
      });
    }

    const { data } = await this.send('Page.captureScreenshot', {
      format,
      quality: format === 'jpeg' ? quality : undefined,
    });

    if (fullPage) {
      await this.send('Emulation.clearDeviceMetricsOverride');
    }

    return data;
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.pendingMessages.clear();
    this.eventHandlers.clear();
    this.currentTabId = null;
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

// Singleton instance
let client: CDPClient | null = null;

export function getClient(): CDPClient | null {
  return client;
}

export function createClient(port: number = 9222, host: string = 'localhost'): CDPClient {
  if (client) {
    client.disconnect();
  }
  client = new CDPClient(port, host);
  return client;
}
