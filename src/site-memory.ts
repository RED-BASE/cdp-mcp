import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Types
interface SiteStructure {
  has_iframes: boolean;
  has_shadow_dom: boolean;
  iframe_count: number;
  iframe_notes: string[];
  shadow_dom_elements: string[];
  form_count: number;
  input_count: number;
}

interface SitePatterns {
  selectors: Record<string, string>;
  notes: string[];
}

interface SiteInfo {
  url: string;
  domain: string;
  last_scanned: string;
  last_epoch: number;
  structure: SiteStructure;
  patterns: SitePatterns;
}

interface SiteMemoryData {
  version: number;
  sites: Record<string, SiteInfo>;
}

interface EpochInfo {
  epoch: number;
  session_id: string | null;
  summary_count: number;
}

// In-memory tracking of scanned URLs this epoch
const scannedThisEpoch: Map<string, boolean> = new Map();
let currentEpoch: number = 0;
let lastCheckedEpoch: number = 0;

// Paths
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const SITE_MEMORY_PATH = path.join(CLAUDE_DIR, 'site-memory.json');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

/**
 * Extract domain from URL
 */
function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return url;
  }
}

/**
 * Load site memory from disk
 */
function loadSiteMemory(): SiteMemoryData {
  try {
    if (fs.existsSync(SITE_MEMORY_PATH)) {
      const data = fs.readFileSync(SITE_MEMORY_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to load site memory:', error);
  }
  return { version: 1, sites: {} };
}

/**
 * Save site memory to disk
 */
function saveSiteMemory(data: SiteMemoryData): void {
  try {
    fs.writeFileSync(SITE_MEMORY_PATH, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Failed to save site memory:', error);
  }
}

/**
 * Find the current session's conversation file and count epochs (summaries/compact_boundaries)
 */
export function getEpochInfo(): EpochInfo {
  try {
    // Find the most recently modified conversation file in projects
    const projectDirs = fs.readdirSync(PROJECTS_DIR).filter(d => {
      const stat = fs.statSync(path.join(PROJECTS_DIR, d));
      return stat.isDirectory();
    });

    let latestFile: string | null = null;
    let latestMtime = 0;
    let sessionId: string | null = null;

    // Look in each project dir for conversation files
    for (const projectDir of projectDirs) {
      const projectPath = path.join(PROJECTS_DIR, projectDir);
      const files = fs.readdirSync(projectPath).filter(f =>
        f.endsWith('.jsonl') &&
        !f.startsWith('agent-') &&
        f.match(/^[a-f0-9-]{36}\.jsonl$/) // UUID format
      );

      for (const file of files) {
        const filePath = path.join(projectPath, file);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs > latestMtime) {
          latestMtime = stat.mtimeMs;
          latestFile = filePath;
          sessionId = file.replace('.jsonl', '');
        }
      }
    }

    if (!latestFile) {
      return { epoch: 0, session_id: null, summary_count: 0 };
    }

    // Count summaries in the file (each summary = one compaction epoch)
    const content = fs.readFileSync(latestFile, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());

    let summaryCount = 0;
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'summary') {
          summaryCount++;
        }
      } catch {
        // Skip malformed lines
      }
    }

    return {
      epoch: summaryCount,
      session_id: sessionId,
      summary_count: summaryCount,
    };
  } catch (error) {
    console.error('Failed to get epoch info:', error);
    return { epoch: 0, session_id: null, summary_count: 0 };
  }
}

/**
 * Check if epoch has changed and reset scanned URLs if so
 */
function checkAndUpdateEpoch(): number {
  const info = getEpochInfo();

  if (info.epoch !== currentEpoch) {
    // Epoch changed - reset scanned URLs
    scannedThisEpoch.clear();
    currentEpoch = info.epoch;
  }

  return currentEpoch;
}

/**
 * Check if a URL has been scanned this epoch
 */
export function wasScannedThisEpoch(url: string): boolean {
  checkAndUpdateEpoch();
  const domain = extractDomain(url);
  return scannedThisEpoch.has(domain);
}

/**
 * Mark a URL as scanned this epoch
 */
export function markScannedThisEpoch(url: string): void {
  checkAndUpdateEpoch();
  const domain = extractDomain(url);
  scannedThisEpoch.set(domain, true);
}

/**
 * Get stored site info for a URL
 */
export function getSiteInfo(url: string): SiteInfo | null {
  const memory = loadSiteMemory();
  const domain = extractDomain(url);
  return memory.sites[domain] || null;
}

/**
 * Store site info for a URL
 */
export function storeSiteInfo(url: string, structure: SiteStructure, patterns?: SitePatterns): SiteInfo {
  const memory = loadSiteMemory();
  const domain = extractDomain(url);
  const epoch = checkAndUpdateEpoch();

  const info: SiteInfo = {
    url,
    domain,
    last_scanned: new Date().toISOString(),
    last_epoch: epoch,
    structure,
    patterns: patterns || { selectors: {}, notes: [] },
  };

  memory.sites[domain] = info;
  saveSiteMemory(memory);
  markScannedThisEpoch(url);

  return info;
}

/**
 * Add a note to site info
 */
export function addSiteNote(url: string, note: string): boolean {
  const memory = loadSiteMemory();
  const domain = extractDomain(url);

  if (!memory.sites[domain]) {
    return false;
  }

  memory.sites[domain].patterns.notes.push(note);
  memory.sites[domain].last_scanned = new Date().toISOString();
  saveSiteMemory(memory);
  return true;
}

/**
 * Add a selector pattern to site info
 */
export function addSiteSelector(url: string, name: string, selector: string): boolean {
  const memory = loadSiteMemory();
  const domain = extractDomain(url);

  if (!memory.sites[domain]) {
    return false;
  }

  memory.sites[domain].patterns.selectors[name] = selector;
  memory.sites[domain].last_scanned = new Date().toISOString();
  saveSiteMemory(memory);
  return true;
}

/**
 * Clear site info for a URL
 */
export function clearSiteInfo(url: string): boolean {
  const memory = loadSiteMemory();
  const domain = extractDomain(url);

  if (memory.sites[domain]) {
    delete memory.sites[domain];
    saveSiteMemory(memory);
    scannedThisEpoch.delete(domain);
    return true;
  }
  return false;
}

/**
 * List all stored sites
 */
export function listSites(): Array<{ domain: string; last_scanned: string; has_iframes: boolean; has_shadow_dom: boolean }> {
  const memory = loadSiteMemory();
  return Object.values(memory.sites).map(site => ({
    domain: site.domain,
    last_scanned: site.last_scanned,
    has_iframes: site.structure.has_iframes,
    has_shadow_dom: site.structure.has_shadow_dom,
  }));
}

/**
 * Get scan decision - should we scan this URL?
 */
export function shouldScan(url: string): { should_scan: boolean; reason: string; cached_info?: SiteInfo } {
  checkAndUpdateEpoch();
  const domain = extractDomain(url);

  // Already scanned this epoch?
  if (scannedThisEpoch.has(domain)) {
    const info = getSiteInfo(url);
    return {
      should_scan: false,
      reason: 'Already scanned this epoch',
      cached_info: info || undefined,
    };
  }

  // Have cached info from previous epoch?
  const info = getSiteInfo(url);
  if (info) {
    return {
      should_scan: true,
      reason: 'New epoch - rescanning for fresh context',
      cached_info: info,
    };
  }

  return {
    should_scan: true,
    reason: 'First time visiting this site',
  };
}
