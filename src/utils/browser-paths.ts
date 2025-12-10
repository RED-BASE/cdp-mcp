import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { homedir, platform } from 'os';
import { join } from 'path';

export interface BrowserInfo {
  name: string;
  path: string;
  type: 'chrome' | 'chromium' | 'edge' | 'brave';
}

const CHROME_PATHS: Record<string, string[]> = {
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/opt/google/chrome/chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/microsoft-edge',
    '/usr/bin/brave-browser',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  ],
};

function getBrowserType(path: string): BrowserInfo['type'] {
  const lowerPath = path.toLowerCase();
  if (lowerPath.includes('chromium')) return 'chromium';
  if (lowerPath.includes('edge') || lowerPath.includes('msedge')) return 'edge';
  if (lowerPath.includes('brave')) return 'brave';
  return 'chrome';
}

function getBrowserName(type: BrowserInfo['type']): string {
  switch (type) {
    case 'chrome': return 'Google Chrome';
    case 'chromium': return 'Chromium';
    case 'edge': return 'Microsoft Edge';
    case 'brave': return 'Brave';
  }
}

function which(command: string): string | null {
  try {
    const result = execSync(`which ${command}`, { encoding: 'utf-8' }).trim();
    return result || null;
  } catch {
    return null;
  }
}

export function findBrowser(preferred?: string): BrowserInfo | null {
  // Check CHROME_PATH env var first
  const envPath = process.env.CHROME_PATH;
  if (envPath && existsSync(envPath)) {
    const type = getBrowserType(envPath);
    return { name: getBrowserName(type), path: envPath, type };
  }

  // If preferred browser specified, try to find it
  if (preferred) {
    const paths = CHROME_PATHS[platform()] || [];
    for (const p of paths) {
      if (p.toLowerCase().includes(preferred.toLowerCase()) && existsSync(p)) {
        const type = getBrowserType(p);
        return { name: getBrowserName(type), path: p, type };
      }
    }
  }

  // Try which for common commands
  const commands = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'];
  for (const cmd of commands) {
    const path = which(cmd);
    if (path && existsSync(path)) {
      const type = getBrowserType(path);
      return { name: getBrowserName(type), path, type };
    }
  }

  // Try known paths
  const paths = CHROME_PATHS[platform()] || [];
  for (const p of paths) {
    if (existsSync(p)) {
      const type = getBrowserType(p);
      return { name: getBrowserName(type), path: p, type };
    }
  }

  return null;
}

export function getAllSearchedPaths(): string[] {
  const paths: string[] = [];

  if (process.env.CHROME_PATH) {
    paths.push(`$CHROME_PATH: ${process.env.CHROME_PATH}`);
  }

  const platformPaths = CHROME_PATHS[platform()] || [];
  paths.push(...platformPaths);

  return paths;
}

export function getCdpMcpDir(): string {
  return join(homedir(), '.cdp-mcp');
}

export function getProfileDir(profileName: string): string {
  return join(getCdpMcpDir(), 'profiles', profileName);
}

export function getDefaultFlags(port: number, profileDir: string, headless: boolean): string[] {
  const flags = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-client-side-phishing-detection',
    '--disable-default-apps',
    '--disable-hang-monitor',
    '--disable-popup-blocking',
    '--disable-prompt-on-repost',
    '--disable-sync',
    '--disable-translate',
    '--metrics-recording-only',
    '--safebrowsing-disable-auto-update',
    '--password-store=basic',
  ];

  if (headless) {
    flags.push(
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--mute-audio',
    );
  }

  return flags;
}
