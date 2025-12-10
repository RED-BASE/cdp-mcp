import { spawn, ChildProcess } from 'child_process';
import { mkdirSync, existsSync } from 'fs';
import { findBrowser, getAllSearchedPaths, getProfileDir, getDefaultFlags, BrowserInfo } from './utils/browser-paths';

export interface LaunchOptions {
  port?: number;
  headless?: boolean;
  browser?: string;
  profile?: string;
  width?: number;
  height?: number;
  startUrl?: string;
  args?: string[];
}

export interface LaunchResult {
  launched: boolean;
  browser?: string;
  version?: string;
  port?: number;
  pid?: number;
  profile?: string;
  profilePath?: string;
  flags?: string[];
  error?: string;
  message?: string;
  suggestion?: string;
  searched?: string[];
}

let browserProcess: ChildProcess | null = null;
let currentPort: number | null = null;

async function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const net = require('net');
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port);
  });
}

async function waitForCdp(port: number, timeout: number = 10000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(`http://localhost:${port}/json/version`);
      if (response.ok) return true;
    } catch {
      // Not ready yet
    }
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

export async function launchBrowser(options: LaunchOptions = {}): Promise<LaunchResult> {
  const {
    port = 9222,
    headless = false,
    browser: preferredBrowser,
    profile = 'cdp-mcp-default',
    width = 1280,
    height = 900,
    startUrl = 'about:blank',
    args = [],
  } = options;

  // Check if port is already in use
  if (await isPortInUse(port)) {
    // Try to connect to see if it's a CDP instance
    try {
      const response = await fetch(`http://localhost:${port}/json/version`);
      if (response.ok) {
        return {
          launched: false,
          error: 'port_in_use',
          message: `Port ${port} is already in use by a CDP instance. Use cdp_connect instead.`,
          suggestion: `cdp_connect(port=${port}) or cdp_launch(port=${port + 1})`,
        };
      }
    } catch {
      return {
        launched: false,
        error: 'port_in_use',
        message: `Port ${port} is already in use by another process.`,
        suggestion: `cdp_launch(port=${port + 1})`,
      };
    }
  }

  // Find browser
  const browserInfo = findBrowser(preferredBrowser);
  if (!browserInfo) {
    return {
      launched: false,
      error: 'no_browser_found',
      message: 'Could not find Chrome, Chromium, or Edge. Install one or set $CHROME_PATH.',
      searched: getAllSearchedPaths(),
    };
  }

  // Create profile directory
  const profilePath = getProfileDir(profile);
  if (!existsSync(profilePath)) {
    mkdirSync(profilePath, { recursive: true });
  }

  // Build flags
  const flags = getDefaultFlags(port, profilePath, headless);
  flags.push(`--window-size=${width},${height}`);
  flags.push(...args);
  flags.push(startUrl);

  // Launch browser
  browserProcess = spawn(browserInfo.path, flags, {
    detached: true,
    stdio: 'ignore',
  });

  browserProcess.unref();
  currentPort = port;

  // Wait for CDP to be ready
  const ready = await waitForCdp(port);
  if (!ready) {
    return {
      launched: false,
      error: 'cdp_timeout',
      message: 'Browser launched but CDP did not respond within timeout.',
    };
  }

  // Get version info
  let version = 'unknown';
  try {
    const response = await fetch(`http://localhost:${port}/json/version`);
    const data = await response.json() as { Browser?: string };
    version = data.Browser || 'unknown';
  } catch {
    // Ignore version fetch errors
  }

  return {
    launched: true,
    browser: browserInfo.name,
    version,
    port,
    pid: browserProcess.pid,
    profile,
    profilePath,
    flags,
  };
}

export function getRunningBrowser(): { port: number; pid: number } | null {
  if (browserProcess && currentPort) {
    return { port: currentPort, pid: browserProcess.pid || 0 };
  }
  return null;
}

export function closeBrowser(): boolean {
  if (browserProcess) {
    browserProcess.kill();
    browserProcess = null;
    currentPort = null;
    return true;
  }
  return false;
}
