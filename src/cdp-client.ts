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

  // Frame/iframe support
  private frameContexts: Map<string, number> = new Map(); // frameId -> executionContextId
  private contextFrames: Map<number, string> = new Map(); // executionContextId -> frameId
  private mainFrameId: string | null = null;

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

      // Set up frame/context tracking
      this.setupFrameTracking();

      // Get initial frame tree
      await this.refreshFrameTree();

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
      // Build a detailed error message with all available information
      const errorParts = [exceptionDetails.text || 'Evaluation error'];

      if (exceptionDetails.exception) {
        const ex = exceptionDetails.exception;
        if (ex.description) errorParts.push(`Description: ${ex.description}`);
        if (ex.className) errorParts.push(`Type: ${ex.className}`);
      }

      if (exceptionDetails.lineNumber !== undefined) {
        errorParts.push(`Line: ${exceptionDetails.lineNumber + 1}`);
      }

      if (exceptionDetails.columnNumber !== undefined) {
        errorParts.push(`Column: ${exceptionDetails.columnNumber + 1}`);
      }

      if (exceptionDetails.stackTrace && exceptionDetails.stackTrace.callFrames) {
        const frames = exceptionDetails.stackTrace.callFrames.slice(0, 3);
        if (frames.length > 0) {
          const stackLines = frames.map((f: any) =>
            `  at ${f.functionName || '(anonymous)'} (${f.url}:${f.lineNumber + 1}:${f.columnNumber + 1})`
          );
          errorParts.push(`Stack:\n${stackLines.join('\n')}`);
        }
      }

      throw new Error(errorParts.join('\n'));
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
    const escapedText = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
    const escapedSelector = selector.replace(/'/g, "\\'");

    // For React controlled inputs, we need to:
    // 1. Set the native value first
    // 2. Then call React's onChange with the element as target (so it reads el.value)
    // 3. Also dispatch standard events for non-React handlers
    const result = await this.evaluate(`
      (() => {
        const el = document.querySelector('${escapedSelector}');
        if (!el) return { success: false, error: 'Element not found' };

        el.focus();

        const newValue = ${clear ? `'${escapedText}'` : `el.value + '${escapedText}'`};

        // Step 1: Set native value first
        const nativeSetter = Object.getOwnPropertyDescriptor(
          el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
          'value'
        )?.set;

        if (nativeSetter) {
          nativeSetter.call(el, newValue);
        } else {
          el.value = newValue;
        }

        // Step 2: Call React's onChange with el as target (it will read el.value)
        const reactProps = Object.keys(el).find(key => key.startsWith('__reactProps$'));
        if (reactProps && el[reactProps] && el[reactProps].onChange) {
          el[reactProps].onChange({ target: el, currentTarget: el });
        }

        // Step 3: Dispatch standard events
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));

        return { success: true, value: el.value };
      })()
    `);

    if (delay > 0) {
      // If delay requested, also simulate keystroke events for bot detection evasion
      for (const char of text) {
        await this.send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: char,
        });
        await this.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: char,
        });
        await new Promise(r => setTimeout(r, delay));
      }
    }

    return result?.success === true;
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

  // Upload file to an element found in shadow DOM via JS evaluation
  async uploadFileToShadowElement(filePath: string): Promise<boolean> {
    try {
      // Get the element stored in window.__fileInput via JS
      const { result } = await this.send('Runtime.evaluate', {
        expression: 'window.__fileInput',
        returnByValue: false,
      });

      if (!result || !result.objectId) {
        return false;
      }

      // Get the node from the object
      const { node } = await this.send('DOM.describeNode', {
        objectId: result.objectId,
      });

      if (!node || !node.backendNodeId) {
        return false;
      }

      // Set files using backendNodeId
      await this.send('DOM.setFileInputFiles', {
        backendNodeId: node.backendNodeId,
        files: [filePath],
      });

      return true;
    } catch (e) {
      return false;
    }
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

  // Frame tracking setup
  private setupFrameTracking(): void {
    // Track execution contexts as they're created
    this.on('Runtime.executionContextCreated', (params: any) => {
      const context = params.context;
      if (context.auxData?.frameId) {
        this.frameContexts.set(context.auxData.frameId, context.id);
        this.contextFrames.set(context.id, context.auxData.frameId);
        if (context.auxData.isDefault && context.auxData.type === 'default') {
          // This is a main document context for this frame
        }
      }
    });

    this.on('Runtime.executionContextDestroyed', (params: any) => {
      const contextId = params.executionContextId;
      const frameId = this.contextFrames.get(contextId);
      if (frameId) {
        this.frameContexts.delete(frameId);
        this.contextFrames.delete(contextId);
      }
    });

    this.on('Runtime.executionContextsCleared', () => {
      this.frameContexts.clear();
      this.contextFrames.clear();
    });
  }

  // Refresh frame tree and execution contexts
  async refreshFrameTree(): Promise<void> {
    try {
      const { frameTree } = await this.send('Page.getFrameTree');
      this.mainFrameId = frameTree.frame.id;

      // Clear and rebuild context map
      this.frameContexts.clear();
      this.contextFrames.clear();

      // Get all execution contexts
      // Note: Contexts should be populated via events, but we can force refresh
      await this.send('Runtime.enable');
    } catch (e) {
      // Frame tree might not be available yet
    }
  }

  // List all frames (main + iframes)
  async listFrames(): Promise<Array<{ id: string; url: string; name: string; isMain: boolean }>> {
    const { frameTree } = await this.send('Page.getFrameTree');
    const frames: Array<{ id: string; url: string; name: string; isMain: boolean }> = [];

    const walkFrames = (node: any, isMain: boolean = true) => {
      frames.push({
        id: node.frame.id,
        url: node.frame.url,
        name: node.frame.name || '',
        isMain,
      });
      if (node.childFrames) {
        for (const child of node.childFrames) {
          walkFrames(child, false);
        }
      }
    };

    walkFrames(frameTree);
    return frames;
  }

  // Evaluate in a specific frame
  async evaluateInFrame(frameId: string, expression: string): Promise<any> {
    // Get the execution context for this frame
    const contextId = this.frameContexts.get(frameId);
    if (!contextId) {
      // Try to refresh and get context
      await this.refreshFrameTree();
      await new Promise(r => setTimeout(r, 100));

      const newContextId = this.frameContexts.get(frameId);
      if (!newContextId) {
        throw new Error(`No execution context for frame: ${frameId}`);
      }
      return this.evaluateWithContext(newContextId, expression);
    }

    return this.evaluateWithContext(contextId, expression);
  }

  // Evaluate with specific context ID
  private async evaluateWithContext(contextId: number, expression: string): Promise<any> {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
      expression,
      contextId,
      returnByValue: true,
      awaitPromise: true,
    });

    if (exceptionDetails) {
      // Build a detailed error message with all available information
      const errorParts = [exceptionDetails.text || 'Evaluation error'];

      if (exceptionDetails.exception) {
        const ex = exceptionDetails.exception;
        if (ex.description) errorParts.push(`Description: ${ex.description}`);
        if (ex.className) errorParts.push(`Type: ${ex.className}`);
      }

      if (exceptionDetails.lineNumber !== undefined) {
        errorParts.push(`Line: ${exceptionDetails.lineNumber + 1}`);
      }

      if (exceptionDetails.columnNumber !== undefined) {
        errorParts.push(`Column: ${exceptionDetails.columnNumber + 1}`);
      }

      if (exceptionDetails.stackTrace && exceptionDetails.stackTrace.callFrames) {
        const frames = exceptionDetails.stackTrace.callFrames.slice(0, 3);
        if (frames.length > 0) {
          const stackLines = frames.map((f: any) =>
            `  at ${f.functionName || '(anonymous)'} (${f.url}:${f.lineNumber + 1}:${f.columnNumber + 1})`
          );
          errorParts.push(`Stack:\n${stackLines.join('\n')}`);
        }
      }

      throw new Error(errorParts.join('\n'));
    }

    return result.value;
  }

  // Find element across all frames
  async findElementInFrames(selector: string): Promise<{ frameId: string; found: boolean } | null> {
    const frames = await this.listFrames();

    for (const frame of frames) {
      try {
        const found = await this.evaluateInFrame(frame.id, `
          !!document.querySelector('${selector.replace(/'/g, "\\'")}')
        `);
        if (found) {
          return { frameId: frame.id, found: true };
        }
      } catch {
        // Frame might not be accessible (cross-origin)
        continue;
      }
    }

    return null;
  }

  // Click element in a specific frame
  async clickInFrame(frameId: string, selector: string): Promise<boolean> {
    try {
      const result = await this.evaluateInFrame(frameId, `
        (() => {
          const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
          if (!el) return { success: false, error: 'Element not found' };
          el.scrollIntoView({ block: 'center', behavior: 'instant' });
          el.click();
          return { success: true };
        })()
      `);
      return result?.success === true;
    } catch (e) {
      return false;
    }
  }

  // Type in element in a specific frame
  async typeInFrame(frameId: string, selector: string, value: string): Promise<boolean> {
    try {
      const result = await this.evaluateInFrame(frameId, `
        (() => {
          const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
          if (!el) return { success: false, error: 'Element not found' };

          el.focus();

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
      return result?.success === true;
    } catch (e) {
      return false;
    }
  }

  // Get main frame ID
  getMainFrameId(): string | null {
    return this.mainFrameId;
  }

  // Insert text at current cursor position using CDP Input.insertText
  // This simulates actual keyboard input, works with React/Angular/Vue controlled inputs
  async insertText(text: string): Promise<boolean> {
    try {
      await this.send('Input.insertText', { text });
      return true;
    } catch (e) {
      return false;
    }
  }

  // Type text character by character with optional delay
  async typeText(text: string, delay: number = 0): Promise<boolean> {
    try {
      for (const char of text) {
        await this.send('Input.insertText', { text: char });
        if (delay > 0) {
          await new Promise(r => setTimeout(r, delay));
        }
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  // Click at raw x,y coordinates (useful for shadow DOM elements)
  async clickAtCoordinates(x: number, y: number, options: { clickCount?: number; button?: 'left' | 'right' | 'middle' } = {}): Promise<boolean> {
    try {
      const { clickCount = 1, button = 'left' } = options;
      await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount });
      await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount });
      return true;
    } catch (e) {
      return false;
    }
  }

  // Press a key (Enter, Tab, Escape, etc.)
  async pressKey(key: string, modifiers: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}): Promise<boolean> {
    try {
      const modifierFlags =
        (modifiers.ctrl ? 2 : 0) |
        (modifiers.shift ? 8 : 0) |
        (modifiers.alt ? 1 : 0);

      await this.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key,
        modifiers: modifierFlags,
      });
      await this.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key,
        modifiers: modifierFlags,
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.pendingMessages.clear();
    this.eventHandlers.clear();
    this.frameContexts.clear();
    this.contextFrames.clear();
    this.currentTabId = null;
    this.mainFrameId = null;
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  // Monaco Editor specific operations
  async monacoEditor(action: 'detect' | 'getValue' | 'setValue' | 'clear', value?: string, editorIndex: number = 0): Promise<any> {
    const detectScript = `
      (function() {
        if (typeof monaco === 'undefined') {
          return { found: false, error: 'Monaco editor not loaded on page' };
        }
        const editors = monaco.editor.getEditors();
        if (!editors || editors.length === 0) {
          return { found: false, error: 'No Monaco editor instances found' };
        }
        return {
          found: true,
          count: editors.length,
          models: editors.map((e, i) => ({
            index: i,
            language: e.getModel()?.getLanguageId() || 'unknown',
            lineCount: e.getModel()?.getLineCount() || 0,
            valueLength: e.getModel()?.getValue().length || 0
          }))
        };
      })()
    `;

    const getValueScript = `
      (function() {
        const editors = monaco.editor.getEditors();
        if (!editors || editors.length === 0) return null;
        if (${editorIndex} >= editors.length) {
          return { error: 'Editor index ${editorIndex} out of range. Found ' + editors.length + ' editors.' };
        }
        return editors[${editorIndex}].getModel().getValue();
      })()
    `;

    const setValueScript = (code: string) => `
      (function() {
        const editors = monaco.editor.getEditors();
        if (!editors || editors.length === 0) {
          return { success: false, error: 'No editor found' };
        }
        if (${editorIndex} >= editors.length) {
          return { success: false, error: 'Editor index ${editorIndex} out of range. Found ' + editors.length + ' editors.' };
        }
        try {
          const editor = editors[${editorIndex}];
          const model = editor.getModel();
          model.setValue(${JSON.stringify(code)});
          return {
            success: true,
            editorIndex: ${editorIndex},
            lineCount: model.getLineCount(),
            valueLength: model.getValue().length
          };
        } catch (e) {
          return { success: false, error: e.toString() };
        }
      })()
    `;

    const clearScript = `
      (function() {
        const editors = monaco.editor.getEditors();
        if (!editors || editors.length === 0) {
          return { success: false, error: 'No editor found' };
        }
        if (${editorIndex} >= editors.length) {
          return { success: false, error: 'Editor index ${editorIndex} out of range. Found ' + editors.length + ' editors.' };
        }
        editors[${editorIndex}].getModel().setValue('');
        return { success: true, editorIndex: ${editorIndex} };
      })()
    `;

    switch (action) {
      case 'detect':
        return await this.evaluate(detectScript);
      case 'getValue':
        return await this.evaluate(getValueScript);
      case 'setValue':
        if (value === undefined) {
          throw new Error('value parameter required for setValue action');
        }
        return await this.evaluate(setValueScript(value));
      case 'clear':
        return await this.evaluate(clearScript);
      default:
        throw new Error(`Unknown Monaco action: ${action}`);
    }
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
