import * as fs from 'fs';
import * as path from 'path';
import { TrackedFile, ContextConfig } from './types';
import { DEFAULT_CATEGORY_MAP, DEFAULT_SOURCE_EXTENSIONS } from './contextDataProvider';

export interface ModuleProposal {
  name: string;
  description: string;
  files: TrackedFile[];
}

export interface CategoryProposal {
  name: string;
  modules: ModuleProposal[];
}

export interface ScanResult {
  categories: CategoryProposal[];
}

function shouldExclude(name: string, excludePatterns: string[]): boolean {
  return excludePatterns.some(p => name === p || name.startsWith('.'));
}

function isSourceFile(fileName: string, extensions: Set<string>): boolean {
  return extensions.has(path.extname(fileName).toLowerCase());
}

function categorizeDirectory(dirName: string, categoryMap: Record<string, string>): string {
  const lower = dirName.toLowerCase();
  return categoryMap[lower] || 'shared';
}

// Generate a one-line description from the file name
function describeFile(filePath: string): string {
  const name = path.basename(filePath, path.extname(filePath));
  // Convert PascalCase/camelCase to readable: "MyComponent" → "My component"
  const readable = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .toLowerCase();
  const ext = path.extname(filePath).slice(1);
  return `${readable} (${ext})`;
}

// Walk directory tree, collect source files grouped by their immediate directory
function walkAndGroup(
  rootDir: string,
  workspaceRoot: string,
  excludePatterns: string[],
  extensions: Set<string>
): Map<string, { dirPath: string; files: string[] }> {
  const groups = new Map<string, { dirPath: string; files: string[] }>();

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const filesInDir: string[] = [];

    for (const entry of entries) {
      if (shouldExclude(entry.name, excludePatterns)) { continue; }

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && isSourceFile(entry.name, extensions)) {
        filesInDir.push(fullPath);
      }
    }

    if (filesInDir.length > 0) {
      const relDir = path.relative(workspaceRoot, dir).replace(/\\/g, '/');
      groups.set(relDir, { dirPath: dir, files: filesInDir });
    }
  }

  walk(rootDir);
  return groups;
}

// Scans a workspace and proposes a .context/ structure
export function scanProject(workspaceRoot: string, config: ContextConfig): ScanResult {
  const categoryModules = new Map<string, Map<string, TrackedFile[]>>();

  // Build extensions set and category map from config (with fallbacks)
  const extensions = new Set(
    (config.sourceExtensions && config.sourceExtensions.length > 0)
      ? config.sourceExtensions
      : [...DEFAULT_SOURCE_EXTENSIONS]
  );
  const categoryMap = (config.categoryMap && Object.keys(config.categoryMap).length > 0)
    ? config.categoryMap
    : DEFAULT_CATEGORY_MAP;

  // Determine scan roots — use config if set, otherwise scan from workspace root
  const roots: string[] = [];
  for (const root of config.scanRoots) {
    const fullPath = path.join(workspaceRoot, root);
    if (fs.existsSync(fullPath)) {
      roots.push(fullPath);
    }
  }

  // If no configured roots exist, scan the workspace root directly
  if (roots.length === 0) {
    roots.push(workspaceRoot);
  }

  for (const root of roots) {
    const groups = walkAndGroup(root, workspaceRoot, config.excludePatterns, extensions);

    for (const [relDir, { files }] of groups) {
      // Use the deepest meaningful directory name for categorization
      const parts = relDir.split('/');
      // Find the first directory name that maps to a known category
      let moduleName = parts[parts.length - 1] || path.basename(root);
      let category = 'shared';

      for (const part of parts) {
        const mapped = categoryMap[part.toLowerCase()];
        if (mapped) {
          category = mapped;
          // If the categorized part is deeper, use the next part as module name
          const idx = parts.indexOf(part);
          if (idx < parts.length - 1) {
            moduleName = parts[idx + 1];
          } else {
            moduleName = part;
          }
          break;
        }
      }

      // Fallback: categorize by the directory name itself
      if (category === 'shared' && parts.length > 0) {
        const guessed = categorizeDirectory(parts[0], categoryMap);
        if (guessed !== 'shared') { category = guessed; }
      }

      if (!categoryModules.has(category)) {
        categoryModules.set(category, new Map());
      }

      const moduleMap = categoryModules.get(category)!;
      if (!moduleMap.has(moduleName)) {
        moduleMap.set(moduleName, []);
      }

      const trackedFiles = moduleMap.get(moduleName)!;
      for (const file of files) {
        const relPath = path.relative(workspaceRoot, file).replace(/\\/g, '/');
        trackedFiles.push({
          path: relPath,
          description: describeFile(file),
        });
      }
    }
  }

  // Convert to proposals
  const categories: CategoryProposal[] = [];

  for (const [catName, moduleMap] of [...categoryModules.entries()].sort()) {
    const modules: ModuleProposal[] = [];

    for (const [modName, files] of [...moduleMap.entries()].sort()) {
      modules.push({
        name: modName.toLowerCase(),
        description: `[AI: describe what ${modName} does]`,
        files: files.sort((a, b) => a.path.localeCompare(b.path)),
      });
    }

    if (modules.length > 0) {
      categories.push({ name: catName, modules });
    }
  }

  return { categories };
}
