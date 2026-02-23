import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import {
  loadAllModules, parseModuleFile, watchContextFolder,
  groupByCategory, checkAllStaleness, initContextFolder,
  loadConfig, addModule, removeModule, touchModule,
  removeFileFromModule, createOverviewFile, createClaudeCommands,
  loadOverviewFile
} from './contextDataProvider';
import { ContextManagerPanel } from './webviewPanel';
import { ModuleFile, StalenessInfo, CategoryGroup } from './types';
import { scanProject } from './projectScanner';

const DISMISSED_WORKSPACES_KEY = 'aiContextManager.dismissedWorkspaces';
const CLAUDE_MD_SETUP_KEY = 'aiContextManager.claudeMdInjected';
const MARKER_START = '<!-- AI-CONTEXT-MANAGER-START -->';
const MARKER_END = '<!-- AI-CONTEXT-MANAGER-END -->';

let fileWatcher: vscode.FileSystemWatcher | undefined;
let statusBarItem: vscode.StatusBarItem;
let moduleCache: ModuleFile[] = [];
let stalenessCache: StalenessInfo[] = [];
let refreshTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

const DEBOUNCE_MS = 300;

// Normalize file paths for reliable comparison on Windows
function normalizePath(p: string): string {
  return path.normalize(p).toLowerCase();
}

function getWorkspacePath(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) { return undefined; }
  return folders[0].uri.fsPath;
}

function getContextFolderPath(): string | undefined {
  const workspacePath = getWorkspacePath();
  if (!workspacePath) { return undefined; }
  const config = vscode.workspace.getConfiguration('aiContextManager');
  const folderName = config.get<string>('contextFolder', '.context');
  return path.join(workspacePath, folderName);
}

function hasContextFolder(): boolean {
  const contextFolder = getContextFolderPath();
  if (!contextFolder) { return false; }
  return fs.existsSync(contextFolder);
}

function fullReload(): void {
  const contextFolder = getContextFolderPath();
  if (!contextFolder || !fs.existsSync(contextFolder)) {
    moduleCache = [];
    stalenessCache = [];
    pushToWebview();
    return;
  }

  const workspacePath = getWorkspacePath()!;
  moduleCache = loadAllModules(contextFolder);
  stalenessCache = checkAllStaleness(moduleCache, workspacePath);
  pushToWebview();
}

// Only re-parse the file that actually changed instead of reloading everything
function reloadSingleFile(changedUri: vscode.Uri): void {
  const filePath = changedUri.fsPath;
  const fileName = path.basename(filePath);
  const normalizedFilePath = normalizePath(filePath);

  // _-prefixed files (e.g. _overview.md, _config.json) are not modules —
  // but changes to them should still refresh the webview (overview content, etc.)
  if (fileName.startsWith('_')) {
    pushToWebview();
    return;
  }

  try {
    fs.statSync(filePath);
  } catch {
    // File gone — drop it from the cache
    moduleCache = moduleCache.filter(m => normalizePath(m.filePath) !== normalizedFilePath);
    stalenessCache = stalenessCache.filter(s => normalizePath(s.module.filePath) !== normalizedFilePath);
    pushToWebview();
    return;
  }

  const updated = parseModuleFile(filePath);
  const idx = moduleCache.findIndex(m => normalizePath(m.filePath) === normalizedFilePath);

  if (idx >= 0) {
    moduleCache[idx] = updated;
  } else {
    moduleCache.push(updated);
  }

  // Recheck staleness for all modules
  const workspacePath = getWorkspacePath();
  if (workspacePath) {
    stalenessCache = checkAllStaleness(moduleCache, workspacePath);
  }

  pushToWebview();
}

function updateStatusBar(): void {
  if (!hasContextFolder()) {
    statusBarItem.text = '$(book) Context';
    statusBarItem.tooltip = 'AI Context Manager — no .context/ folder';
    return;
  }

  const staleCount = stalenessCache.filter(s => s.isStale).length;
  const undocumentedCount = stalenessCache.filter(s => s.isUndocumented).length;
  const totalModules = moduleCache.filter(m => !m.parseError).length;

  const parts: string[] = [];
  if (undocumentedCount > 0) { parts.push(`${undocumentedCount} undocumented`); }
  if (staleCount > 0) { parts.push(`${staleCount} stale`); }

  if (parts.length > 0) {
    statusBarItem.text = `$(book) Context: ${parts.join(', ')}`;
    statusBarItem.tooltip = `AI Context Manager — ${totalModules} module${totalModules === 1 ? '' : 's'}: ${parts.join(', ')}`;
  } else if (totalModules > 0) {
    statusBarItem.text = '$(book) Context: fresh';
    statusBarItem.tooltip = `AI Context Manager — ${totalModules} module${totalModules === 1 ? '' : 's'}, all up to date`;
  } else {
    statusBarItem.text = '$(book) Context';
    statusBarItem.tooltip = 'AI Context Manager — no modules yet';
  }
}

function pushToWebview(): void {
  updateStatusBar();
  if (!ContextManagerPanel.currentPanel) {
    return;
  }

  const categories = groupByCategory(moduleCache);
  // Build a staleness map keyed by file path for the webview
  const stalenessMap: Record<string, { isStale: boolean; staleFiles: string[]; isUndocumented: boolean }> = {};
  for (const info of stalenessCache) {
    stalenessMap[info.module.filePath] = { isStale: info.isStale, staleFiles: info.staleFiles, isUndocumented: info.isUndocumented };
  }

  // Load overview content for the webview header
  const contextFolder = getContextFolderPath();
  const overviewContent = contextFolder ? loadOverviewFile(contextFolder) || '' : '';

  ContextManagerPanel.currentPanel.updateData(categories, stalenessMap, overviewContent);
}

// All file watcher events are debounced per-file so rapid saves don't thrash the parser
// and events for different files aren't dropped
function debouncedFileAction(uri: vscode.Uri, action: () => void): void {
  const key = normalizePath(uri.fsPath);
  const existing = refreshTimers.get(key);
  if (existing) { clearTimeout(existing); }
  refreshTimers.set(key, setTimeout(() => {
    refreshTimers.delete(key);
    action();
  }, DEBOUNCE_MS));
}

function onFileChanged(uri: vscode.Uri): void {
  debouncedFileAction(uri, () => reloadSingleFile(uri));
}

function onFileDeleted(uri: vscode.Uri): void {
  const normalizedPath = normalizePath(uri.fsPath);
  debouncedFileAction(uri, () => {
    moduleCache = moduleCache.filter(m => normalizePath(m.filePath) !== normalizedPath);
    stalenessCache = stalenessCache.filter(s => normalizePath(s.module.filePath) !== normalizedPath);
    pushToWebview();
  });
}

function onFileCreated(uri: vscode.Uri): void {
  debouncedFileAction(uri, () => reloadSingleFile(uri));
}

function setupFileWatcher(context: vscode.ExtensionContext): void {
  if (fileWatcher) {
    fileWatcher.dispose();
  }

  const contextFolder = getContextFolderPath();
  if (!contextFolder || !fs.existsSync(contextFolder)) {
    return;
  }

  fileWatcher = watchContextFolder(contextFolder, onFileChanged, onFileCreated, onFileDeleted);
  context.subscriptions.push(fileWatcher);
}

// --- Init command: scan project and create .context/ ---

async function runInitCommand(): Promise<void> {
  const workspacePath = getWorkspacePath();
  if (!workspacePath) {
    vscode.window.showWarningMessage('No workspace folder open.');
    return;
  }

  const contextFolder = getContextFolderPath()!;

  if (fs.existsSync(contextFolder)) {
    const choice = await vscode.window.showWarningMessage(
      '.context/ folder already exists. Re-scan and add new modules?',
      'Re-scan',
      'Cancel'
    );
    if (choice !== 'Re-scan') { return; }
  }

  // Load or create config
  const config = fs.existsSync(contextFolder) ? loadConfig(contextFolder) : undefined;

  // Initialise the folder structure
  initContextFolder(contextFolder, config);

  // Scan the project
  const scanConfig = loadConfig(contextFolder);
  const result = scanProject(workspacePath, scanConfig);

  if (result.categories.length === 0) {
    vscode.window.showInformationMessage('No source files found to categorise. The .context/ folder has been created with empty categories.');
    fullReload();
    return;
  }

  // Build a summary for the user
  const totalModules = result.categories.reduce((sum, c) => sum + c.modules.length, 0);
  const totalFiles = result.categories.reduce((sum, c) =>
    sum + c.modules.reduce((mSum, m) => mSum + m.files.length, 0), 0);

  const summary = result.categories
    .map(c => `  ${c.name}: ${c.modules.map(m => m.name).join(', ')}`)
    .join('\n');

  const choice = await vscode.window.showInformationMessage(
    `Found ${totalModules} modules across ${result.categories.length} categories (${totalFiles} files). Create context files?`,
    { modal: true, detail: summary },
    'Create',
    'Cancel'
  );

  if (choice !== 'Create') { return; }

  // Create all the module files
  for (const cat of result.categories) {
    for (const mod of cat.modules) {
      addModule(contextFolder, cat.name, mod.name, mod.description, mod.files);
    }
  }

  // Create the _overview.md skeleton
  const freshModules = loadAllModules(contextFolder);
  createOverviewFile(contextFolder, workspacePath, freshModules);

  // Create .claude/commands/ slash commands for Claude Code
  createClaudeCommands(workspacePath);

  vscode.window.showInformationMessage(`Created ${totalModules} context module files in .context/`);
  fullReload();
}

// --- CLAUDE.md auto-injection ---

const CLAUDE_MD_INSTRUCTIONS = `${MARKER_START}
## Context Management (RECOMMENDED)

This project uses \`.context/\` for codebase documentation. **When asked to review, explore, or understand this project, start by reading \`.context/_overview.md\`.**

### Slash commands (Claude Code)
- \`/project:context-create\` — populate all undocumented modules with real documentation
- \`/project:context-review\` — review and update existing context for accuracy
- \`/project:context-update\` — update context after recent code changes

### First-time setup
If \`.context/_config.json\` has \`"needsAiSetup": true\`, this is a fresh init:
1. Check the project type (look at file extensions, package.json, project files, etc.)
2. Update \`_config.json\` fields: \`sourceExtensions\`, \`categoryMap\`, \`categories\`, and \`scanRoots\` to match this project
3. Set \`"needsAiSetup": false\`
4. Tell the user to re-run "Initialise .context/" to re-scan with the updated config

### Before working on code:
1. Read \`.context/_overview.md\` first for project orientation
2. Read relevant module files in \`.context/<category>/<module>.md\`
3. If any module has \`[AI: ...]\` placeholder text, fill it in as you work

### After making changes:
1. Update the relevant \`.context/<category>/<module>.md\` file
2. Add/remove file entries to match source file changes
3. Set \`lastUpdated\` to the current ISO timestamp
4. Update the markdown body if architecture or patterns changed
5. Update \`.context/_overview.md\` if project structure changed significantly

### Writing guidelines
- \`_overview.md\` is an INDEX, not documentation — keep it short
- Module docs: a few concise lines per section, not essays
- Format: what it does, key patterns, important decisions
- File descriptions: one line each

### .context/ structure
\`\`\`
.context/
\u251c\u2500\u2500 _overview.md              \u2190 project summary and module index (read first)
\u251c\u2500\u2500 _config.json              \u2190 scan settings, exclusions
\u251c\u2500\u2500 <category>/
\u2502   \u2514\u2500\u2500 <module>.md           \u2190 frontmatter JSON + markdown documentation
\`\`\`

### Rules
- Always set \`lastUpdated\` to the current ISO timestamp when modifying a module file
- Keep file descriptions concise (one line)
- Add/remove file entries when source files are created/deleted
- Do NOT touch \`_config.json\`. Maintain \`_overview.md\` as the project index.
- Replace \`[AI: ...]\` placeholders with real content whenever you encounter them
${MARKER_END}`;

function getClaudeMdPath(): string {
  return path.join(os.homedir(), '.claude', 'CLAUDE.md');
}

function claudeMdHasMarkers(content: string): boolean {
  return content.includes(MARKER_START) && content.includes(MARKER_END);
}

function injectClaudeMdInstructions(context: vscode.ExtensionContext, onComplete: () => void): void {
  // Already set up in a previous activation
  if (context.globalState.get(CLAUDE_MD_SETUP_KEY, false)) {
    const claudePath = getClaudeMdPath();
    try {
      const content = fs.readFileSync(claudePath, 'utf-8');
      if (claudeMdHasMarkers(content)) { onComplete(); return; }
    } catch {
      // File doesn't exist — fall through to prompt
    }
    // Markers gone — reset flag so we can offer again
    context.globalState.update(CLAUDE_MD_SETUP_KEY, false);
  }

  const claudePath = getClaudeMdPath();
  let existingContent = '';
  let fileExists = false;

  try {
    existingContent = fs.readFileSync(claudePath, 'utf-8');
    fileExists = true;
    if (claudeMdHasMarkers(existingContent)) {
      context.globalState.update(CLAUDE_MD_SETUP_KEY, true);
      onComplete();
      return;
    }
  } catch {
    // File doesn't exist yet
  }

  vscode.window.showInformationMessage(
    'AI Context Manager can add codebase documentation instructions to your CLAUDE.md so AI assistants automatically read and update .context/ files. Set up now?',
    'Set up',
    'Skip'
  ).then(choice => {
    if (choice === 'Set up') {
      const claudeDir = path.dirname(claudePath);
      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }

      const newContent = fileExists
        ? existingContent.trimEnd() + '\n\n' + CLAUDE_MD_INSTRUCTIONS + '\n'
        : CLAUDE_MD_INSTRUCTIONS + '\n';

      fs.writeFileSync(claudePath, newContent, 'utf-8');
      context.globalState.update(CLAUDE_MD_SETUP_KEY, true);
      vscode.window.showInformationMessage('Context management instructions added to CLAUDE.md.');
    } else if (choice === 'Skip') {
      context.globalState.update(CLAUDE_MD_SETUP_KEY, true);
    }
    onComplete();
  });
}

function checkWorkspaceAndPrompt(context: vscode.ExtensionContext): void {
  const config = vscode.workspace.getConfiguration('aiContextManager');
  if (!config.get<boolean>('autoInitPrompt', true)) { return; }

  const workspacePath = getWorkspacePath();
  if (!workspacePath) { return; }

  if (hasContextFolder()) { return; }

  const dismissed: string[] = context.globalState.get(DISMISSED_WORKSPACES_KEY, []);
  if (dismissed.includes(normalizePath(workspacePath))) { return; }

  vscode.window.showInformationMessage(
    'No .context/ folder found. Initialise codebase context mapping?',
    'Initialise',
    'Don\'t ask again'
  ).then(choice => {
    if (choice === 'Initialise') {
      runInitCommand();
    } else if (choice === 'Don\'t ask again') {
      dismissed.push(normalizePath(workspacePath));
      context.globalState.update(DISMISSED_WORKSPACES_KEY, dismissed);
    }
  });
}

export function activate(context: vscode.ExtensionContext) {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0);
  statusBarItem.command = 'aiContextManager.toggle';
  statusBarItem.text = '$(book) Context';
  statusBarItem.tooltip = 'Toggle AI Context Manager';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Toggle command
  const toggleCommand = vscode.commands.registerCommand(
    'aiContextManager.toggle',
    () => {
      if (ContextManagerPanel.currentPanel) {
        ContextManagerPanel.currentPanel.dispose();
      } else {
        const panel = ContextManagerPanel.createOrShow(context.extensionUri);
        const wp = getWorkspacePath();
        const cf = getContextFolderPath();
        if (wp && cf) { panel.setPaths(wp, cf); }
        panel.onDidModifyModule((filePath) => {
          onFileChanged(vscode.Uri.file(filePath));
        });
        panel.onDidBecomeVisible(() => {
          fullReload();
        });
        fullReload();
      }
    }
  );
  context.subscriptions.push(toggleCommand);

  // Init command
  const initCommand = vscode.commands.registerCommand(
    'aiContextManager.init',
    () => runInitCommand()
  );
  context.subscriptions.push(initCommand);

  // Refresh command
  const refreshCommand = vscode.commands.registerCommand(
    'aiContextManager.refresh',
    () => fullReload()
  );
  context.subscriptions.push(refreshCommand);

  // Setup watcher and load cache
  setupFileWatcher(context);
  fullReload();

  // Offer CLAUDE.md injection, then prompt for .context/ init
  injectClaudeMdInstructions(context, () => {
    checkWorkspaceAndPrompt(context);
  });

  // React to configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('aiContextManager.contextFolder')) {
        setupFileWatcher(context);
        fullReload();
      }
    })
  );
}

export function deactivate() {
  if (fileWatcher) { fileWatcher.dispose(); }
  for (const timer of refreshTimers.values()) { clearTimeout(timer); }
  refreshTimers.clear();
}
