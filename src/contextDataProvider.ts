import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { jsonrepair } from 'jsonrepair';
import { ModuleFile, ModuleData, TrackedFile, ContextConfig, CategoryGroup, StalenessInfo } from './types';

const MAX_FILE_SIZE = 1024 * 1024; // 1 MB
const OVERVIEW_FILENAME = '_overview.md';

// Regex to detect auto-generated placeholder text in module bodies and descriptions
export const PLACEHOLDER_PATTERN = /\[AI: .+?\]/;

const DEFAULT_SOURCE_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte',
  '.py', '.rb', '.go', '.rs', '.java', '.kt',
  '.css', '.scss', '.less', '.sass',
  '.html', '.htm', '.ejs', '.hbs', '.pug',
  '.json', '.yaml', '.yml', '.toml',
  '.sql', '.graphql', '.gql',
  '.md', '.mdx',
];

const DEFAULT_CATEGORY_MAP: Record<string, string> = {
  // Frontend
  'components': 'frontend', 'pages': 'frontend', 'views': 'frontend',
  'hooks': 'frontend', 'styles': 'frontend', 'css': 'frontend',
  'scss': 'frontend', 'layouts': 'frontend', 'ui': 'frontend',
  'widgets': 'frontend', 'screens': 'frontend', 'templates': 'frontend',
  // Backend
  'api': 'backend', 'routes': 'backend', 'controllers': 'backend',
  'middleware': 'backend', 'services': 'backend', 'handlers': 'backend',
  'server': 'backend', 'endpoints': 'backend', 'graphql': 'backend',
  // Data
  'models': 'backend', 'database': 'backend', 'db': 'backend',
  'migrations': 'backend', 'schema': 'backend', 'prisma': 'backend',
  // Shared
  'types': 'shared', 'interfaces': 'shared', 'utils': 'shared',
  'helpers': 'shared', 'lib': 'shared', 'shared': 'shared',
  'common': 'shared', 'constants': 'shared', 'config': 'shared',
  // Assets
  'assets': 'assets', 'images': 'assets', 'icons': 'assets',
  'fonts': 'assets', 'public': 'assets', 'static': 'assets', 'media': 'assets',
};

const DEFAULT_CONFIG: ContextConfig = {
  categories: ['frontend', 'backend', 'shared', 'assets'],
  excludePatterns: ['node_modules', '.git', 'dist', 'build', '.next', '.cache', 'coverage'],
  scanRoots: ['src', 'lib', 'app'],
  sourceExtensions: DEFAULT_SOURCE_EXTENSIONS,
  categoryMap: DEFAULT_CATEGORY_MAP,
  needsAiSetup: true,
};

// Builds a placeholder entry for files that couldn't be parsed
function errorEntry(filePath: string, reason: string): ModuleFile {
  const category = path.basename(path.dirname(filePath));
  return {
    filePath,
    fileName: path.basename(filePath),
    category,
    data: { module: path.basename(filePath, '.md'), category, description: '', lastUpdated: '', files: [] },
    body: '',
    parseError: reason,
  };
}

// Reads a .md file and pulls out the JSON frontmatter + markdown body
export function parseModuleFile(filePath: string): ModuleFile {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_FILE_SIZE) {
      return errorEntry(filePath, `File too large (${(stat.size / 1024).toFixed(0)} KB — limit is 1 MB)`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const fileName = path.basename(filePath);
    const category = path.basename(path.dirname(filePath));

    // Grab everything between the --- markers as JSON, rest is markdown
    const frontmatterMatch = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/);
    if (!frontmatterMatch) {
      return errorEntry(filePath, 'Missing or malformed --- frontmatter delimiters');
    }

    const jsonStr = frontmatterMatch[1].trim();
    const markdownBody = frontmatterMatch[2].trim();

    let data: ModuleData;
    let repaired = false;
    try {
      data = JSON.parse(jsonStr);
    } catch {
      // Attempt to repair broken JSON (missing commas, trailing commas, etc.)
      try {
        const fixed = jsonrepair(jsonStr);
        data = JSON.parse(fixed);
        repaired = true;
      } catch (repairErr: any) {
        return errorEntry(filePath, `Invalid JSON in frontmatter (repair failed): ${repairErr.message}`);
      }
    }

    if (!data.module || typeof data.module !== 'string') {
      return errorEntry(filePath, 'Missing or invalid "module" in frontmatter');
    }
    if (!Array.isArray(data.files)) {
      return errorEntry(filePath, 'Missing or invalid "files" array in frontmatter');
    }

    const result: ModuleFile = { filePath, fileName, category, data, body: markdownBody };

    // Write the repaired JSON back so the file stays clean
    if (repaired) {
      saveModuleFile(result);
    }

    return result;
  } catch (err: any) {
    return errorEntry(filePath, `Cannot read file: ${err.message}`);
  }
}

// Writes a module file back to disk (JSON frontmatter + markdown body)
export function saveModuleFile(module: ModuleFile): void {
  const json = JSON.stringify(module.data, null, 2);
  const content = `---\n${json}\n---\n\n${module.body}\n`;
  fs.writeFileSync(module.filePath, content, 'utf-8');
}

// Loads every .md file in the .context/ folder recursively
export function loadAllModules(contextFolder: string): ModuleFile[] {
  if (!fs.existsSync(contextFolder)) {
    return [];
  }

  const modules: ModuleFile[] = [];

  const entries = fs.readdirSync(contextFolder, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) {
      continue;
    }

    const categoryDir = path.join(contextFolder, entry.name);
    const files = fs.readdirSync(categoryDir).filter(f => f.endsWith('.md') && !f.startsWith('_'));

    for (const file of files) {
      modules.push(parseModuleFile(path.join(categoryDir, file)));
    }
  }

  return modules;
}

// Reads .context/_config.json, returns defaults if missing
export function loadConfig(contextFolder: string): ContextConfig {
  const configPath = path.join(contextFolder, '_config.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

// Writes .context/_config.json
export function saveConfig(contextFolder: string, config: ContextConfig): void {
  const configPath = path.join(contextFolder, '_config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

// Groups modules by category for the tree view
export function groupByCategory(modules: ModuleFile[]): CategoryGroup[] {
  const map = new Map<string, ModuleFile[]>();

  for (const mod of modules) {
    const cat = mod.category;
    if (!map.has(cat)) {
      map.set(cat, []);
    }
    map.get(cat)!.push(mod);
  }

  // Sort categories alphabetically, modules alphabetically within each
  const groups: CategoryGroup[] = [];
  for (const [name, mods] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    groups.push({ name, modules: mods.sort((a, b) => a.data.module.localeCompare(b.data.module)) });
  }

  return groups;
}

// Checks whether a module still has auto-generated placeholder content
export function isModuleUndocumented(module: ModuleFile): boolean {
  if (module.parseError) { return false; }
  return PLACEHOLDER_PATTERN.test(module.data.description) || PLACEHOLDER_PATTERN.test(module.body);
}

// Checks staleness for a single module by comparing file mtimes vs lastUpdated.
// Uses the module file's own mtime as a floor — if AI wrote a stale timestamp
// but just saved the file, the file's mtime is the real "last documented" time.
export function checkStaleness(module: ModuleFile, workspaceRoot: string): StalenessInfo {
  const undocumented = isModuleUndocumented(module);

  if (module.parseError || !module.data.lastUpdated) {
    return { module, staleFiles: [], isStale: false, isUndocumented: undocumented };
  }

  const lastUpdated = Date.parse(module.data.lastUpdated);
  if (isNaN(lastUpdated)) {
    return { module, staleFiles: [], isStale: false, isUndocumented: undocumented };
  }

  // Use the later of frontmatter timestamp and module file mtime
  let effectiveUpdated = lastUpdated;
  try {
    const moduleMtime = fs.statSync(module.filePath).mtimeMs;
    if (moduleMtime > effectiveUpdated) {
      effectiveUpdated = moduleMtime;
    }
  } catch { /* module file gone — use frontmatter timestamp */ }

  const staleFiles: string[] = [];

  for (const tracked of module.data.files) {
    try {
      const fullPath = path.join(workspaceRoot, tracked.path);
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs > effectiveUpdated) {
        staleFiles.push(tracked.path);
      }
    } catch {
      // File doesn't exist — could be stale (deleted), mark it
      staleFiles.push(tracked.path);
    }
  }

  return { module, staleFiles, isStale: staleFiles.length > 0, isUndocumented: undocumented };
}

// Checks staleness for all modules
export function checkAllStaleness(modules: ModuleFile[], workspaceRoot: string): StalenessInfo[] {
  return modules.map(m => checkStaleness(m, workspaceRoot));
}

// Creates a new module .md file
export function addModule(
  contextFolder: string,
  category: string,
  moduleName: string,
  description: string,
  files: TrackedFile[] = []
): ModuleFile {
  const categoryDir = path.join(contextFolder, category);
  if (!fs.existsSync(categoryDir)) {
    fs.mkdirSync(categoryDir, { recursive: true });
  }

  const now = new Date().toISOString();
  const data: ModuleData = {
    module: moduleName,
    category,
    description,
    lastUpdated: now,
    files,
  };

  const filePath = path.join(categoryDir, `${moduleName}.md`);
  const module: ModuleFile = {
    filePath,
    fileName: `${moduleName}.md`,
    category,
    data,
    body: `## ${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)}\n\n[AI: describe what this module does, its patterns, and key decisions.]\n\n### Key files\n${files.map(f => `- \`${f.path}\` — ${f.description}`).join('\n')}\n`,
  };

  saveModuleFile(module);
  return module;
}

// Deletes a module .md file
export function removeModule(modulePath: string): boolean {
  try {
    fs.unlinkSync(modulePath);

    // If category folder is now empty, remove it
    const categoryDir = path.dirname(modulePath);
    const remaining = fs.readdirSync(categoryDir).filter(f => f.endsWith('.md'));
    if (remaining.length === 0) {
      fs.rmdirSync(categoryDir);
    }

    return true;
  } catch {
    return false;
  }
}

// Adds a tracked file to a module
export function addFileToModule(modulePath: string, trackedFile: TrackedFile): ModuleFile | null {
  const module = parseModuleFile(modulePath);
  if (module.parseError) { return null; }

  // Don't add duplicates
  if (module.data.files.some(f => f.path === trackedFile.path)) { return module; }

  module.data.files.push(trackedFile);
  module.data.lastUpdated = new Date().toISOString();
  saveModuleFile(module);
  return module;
}

// Removes a tracked file from a module
export function removeFileFromModule(modulePath: string, filePath: string): ModuleFile | null {
  const module = parseModuleFile(modulePath);
  if (module.parseError) { return null; }

  const before = module.data.files.length;
  module.data.files = module.data.files.filter(f => f.path !== filePath);
  if (module.data.files.length === before) { return null; }

  module.data.lastUpdated = new Date().toISOString();
  saveModuleFile(module);
  return module;
}

// Marks a module as freshly updated
export function touchModule(modulePath: string): ModuleFile | null {
  const module = parseModuleFile(modulePath);
  if (module.parseError) { return null; }

  module.data.lastUpdated = new Date().toISOString();
  saveModuleFile(module);
  return module;
}

// Creates the .context/ skeleton
export function initContextFolder(contextFolder: string, config?: ContextConfig): void {
  const cfg = config || DEFAULT_CONFIG;

  if (!fs.existsSync(contextFolder)) {
    fs.mkdirSync(contextFolder, { recursive: true });
  }

  // Write config
  saveConfig(contextFolder, cfg);

  // Create category directories
  for (const cat of cfg.categories) {
    const catDir = path.join(contextFolder, cat);
    if (!fs.existsSync(catDir)) {
      fs.mkdirSync(catDir, { recursive: true });
    }
  }
}

// Creates the _overview.md skeleton in the .context/ root
export function createOverviewFile(contextFolder: string, workspaceRoot: string, modules: ModuleFile[]): void {
  const overviewPath = path.join(contextFolder, OVERVIEW_FILENAME);
  // Don't overwrite if it already exists
  if (fs.existsSync(overviewPath)) { return; }

  // Try to derive project name from package.json, else folder name
  let projectName = path.basename(workspaceRoot);
  try {
    const pkgPath = path.join(workspaceRoot, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    if (pkg.displayName) { projectName = pkg.displayName; }
    else if (pkg.name) { projectName = pkg.name; }
  } catch { /* no package.json — use folder name */ }

  // Build module index from what was just scanned
  const moduleIndex = modules
    .filter(m => !m.parseError)
    .map(m => `- \`.context/${m.category}/${m.fileName}\` — ${m.data.description}`)
    .join('\n');

  const content = `# ${projectName}\n\n[AI: one-sentence description of what this project does.]\n\n## Tech Stack\n[AI: list frameworks, languages, build tools — one bullet each.]\n\n## Modules\n${moduleIndex || '[No modules yet]'}\n\n## Key Decisions\n[AI: list 2-3 important architectural decisions — one bullet each.]\n`;

  fs.writeFileSync(overviewPath, content, 'utf-8');
}

// Reads _overview.md if it exists, returns null otherwise
export function loadOverviewFile(contextFolder: string): string | null {
  const overviewPath = path.join(contextFolder, OVERVIEW_FILENAME);
  try {
    return fs.readFileSync(overviewPath, 'utf-8');
  } catch {
    return null;
  }
}

// Checks if _overview.md still has placeholder content
export function isOverviewUndocumented(contextFolder: string): boolean {
  const content = loadOverviewFile(contextFolder);
  if (!content) { return true; }
  return PLACEHOLDER_PATTERN.test(content);
}

// Creates .claude/commands/ slash commands for Claude Code integration
export function createClaudeCommands(workspaceRoot: string): void {
  const commandsDir = path.join(workspaceRoot, '.claude', 'commands');
  if (!fs.existsSync(commandsDir)) {
    fs.mkdirSync(commandsDir, { recursive: true });
  }

  const commands: Record<string, string> = {
    'context-create.md': `First, read .context/_config.json. If "needsAiSetup" is true:
1. Check the project type (look at file extensions present, package.json, project files, etc.)
2. Update _config.json: set sourceExtensions, categoryMap, categories, and scanRoots to match this project
3. Set "needsAiSetup" to false
4. Tell the user to re-run "Initialise .context/" (Ctrl+Shift+P → "AI Context Manager: Initialise .context/") to re-scan with the updated config, then run this command again

If "needsAiSetup" is false, proceed:

Read the .context/_overview.md and all module files in .context/ to understand the current state.

For every module that still has [AI: ...] placeholder text:
1. Read the source files listed in that module's frontmatter "files" array
2. Replace the [AI: ...] placeholders with concise, real documentation:
   - Description: one sentence explaining what this module does
   - Body: what it does, key patterns, important decisions (a few lines each, not essays)
   - File descriptions: update generic ones like "button (tsx)" with what the file actually does
3. Set "lastUpdated" to the current ISO timestamp

Then update .context/_overview.md:
- Replace any [AI: ...] placeholders with real content
- Keep it SHORT — it's an index, not documentation
- Tech stack: one bullet per tool/framework
- Key decisions: 2-3 bullets max

Do NOT over-document. A few clear lines per section is better than paragraphs.`,

    'context-review.md': `Review the .context/ folder for accuracy and freshness.

1. Read .context/_overview.md — is it accurate? Update if the project has changed.
2. For each module file in .context/<category>/<module>.md:
   - Read the tracked source files
   - Check if the documentation still matches the code
   - Update descriptions, patterns, and key decisions if they've drifted
   - Add any new source files that aren't tracked yet
   - Remove entries for deleted files
   - Set "lastUpdated" to now for any modules you update
3. Report what you found and changed.

Keep documentation concise. Don't pad with filler.`,

    'context-update.md': `Update .context/ module files to reflect recent code changes.

1. Check which files were recently modified (git diff or file timestamps)
2. For each modified file, find its .context/ module
3. Update the module documentation to reflect the changes:
   - Update file descriptions if functionality changed
   - Update the markdown body if patterns or architecture changed
   - Add new file entries for newly created files
   - Remove entries for deleted files
   - Set "lastUpdated" to the current ISO timestamp
4. Update .context/_overview.md if the changes affect project structure

Be surgical — only update what actually changed. Don't rewrite modules that are still accurate.`,
  };

  for (const [filename, content] of Object.entries(commands)) {
    const filePath = path.join(commandsDir, filename);
    // Don't overwrite if user customised them
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content, 'utf-8');
    }
  }
}

// Watches the .context/ folder for .md file changes
export function watchContextFolder(
  contextFolder: string,
  onChange: (uri: vscode.Uri) => void,
  onCreate: (uri: vscode.Uri) => void,
  onDelete: (uri: vscode.Uri) => void
): vscode.FileSystemWatcher {
  const pattern = new vscode.RelativePattern(vscode.Uri.file(contextFolder), '**/*.md');
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);

  watcher.onDidChange(onChange);
  watcher.onDidCreate(onCreate);
  watcher.onDidDelete(onDelete);

  return watcher;
}
