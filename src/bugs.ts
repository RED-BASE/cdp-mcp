import * as fs from 'fs';
import * as path from 'path';

// Bug file lives in the cdp-mcp folder itself
const BUGS_FILE = path.join(__dirname, '..', 'BUGS.md');

interface Bug {
  id: string;
  title: string;
  description: string;
  reported: string;
  context?: string;
}

/**
 * Generate a short unique ID
 */
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * Parse bugs from the markdown file
 */
function parseBugs(): Bug[] {
  if (!fs.existsSync(BUGS_FILE)) {
    return [];
  }

  const content = fs.readFileSync(BUGS_FILE, 'utf-8');
  const bugs: Bug[] = [];

  // Parse markdown format:
  // ## [id] Title
  // **Reported:** date
  // **Context:** optional context
  // Description text...

  const bugSections = content.split(/^## /m).slice(1); // Split by ## and skip header

  for (const section of bugSections) {
    const lines = section.trim().split('\n');
    if (lines.length === 0) continue;

    // First line: [id] Title
    const headerMatch = lines[0].match(/^\[([^\]]+)\]\s*(.+)$/);
    if (!headerMatch) continue;

    const id = headerMatch[1];
    const title = headerMatch[2];

    let reported = '';
    let context = '';
    const descLines: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('**Reported:**')) {
        reported = line.replace('**Reported:**', '').trim();
      } else if (line.startsWith('**Context:**')) {
        context = line.replace('**Context:**', '').trim();
      } else if (line.trim()) {
        descLines.push(line);
      }
    }

    bugs.push({
      id,
      title,
      description: descLines.join('\n').trim(),
      reported,
      context: context || undefined,
    });
  }

  return bugs;
}

/**
 * Write bugs to the markdown file
 */
function writeBugs(bugs: Bug[]): void {
  let content = '# CDP-MCP Known Bugs\n\n';
  content += 'Tracked issues to fix. Use `cdp_fix_bug` to mark as resolved.\n\n';

  for (const bug of bugs) {
    content += `## [${bug.id}] ${bug.title}\n`;
    content += `**Reported:** ${bug.reported}\n`;
    if (bug.context) {
      content += `**Context:** ${bug.context}\n`;
    }
    content += `\n${bug.description}\n\n`;
  }

  fs.writeFileSync(BUGS_FILE, content);
}

/**
 * Add a new bug
 */
export function trackBug(title: string, description: string, context?: string): Bug {
  const bugs = parseBugs();

  const bug: Bug = {
    id: generateId(),
    title,
    description,
    reported: new Date().toISOString().split('T')[0],
    context,
  };

  bugs.push(bug);
  writeBugs(bugs);

  return bug;
}

/**
 * Get all bugs
 */
export function getBugs(): Bug[] {
  return parseBugs();
}

/**
 * Get a specific bug by ID
 */
export function getBug(id: string): Bug | null {
  const bugs = parseBugs();
  return bugs.find(b => b.id === id) || null;
}

/**
 * Remove a bug (mark as fixed)
 */
export function fixBug(id: string): { removed: boolean; bug?: Bug } {
  const bugs = parseBugs();
  const index = bugs.findIndex(b => b.id === id);

  if (index === -1) {
    return { removed: false };
  }

  const [removed] = bugs.splice(index, 1);
  writeBugs(bugs);

  return { removed: true, bug: removed };
}

/**
 * Get the bugs file path
 */
export function getBugsFilePath(): string {
  return BUGS_FILE;
}
