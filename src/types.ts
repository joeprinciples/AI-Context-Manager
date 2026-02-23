/** A single file tracked within a module */
export interface TrackedFile {
  path: string;           // Relative to workspace root, e.g. "src/components/Button.tsx"
  description: string;    // One-line summary
}

/** JSON frontmatter of a .context/<category>/<module>.md file */
export interface ModuleData {
  module: string;          // e.g. "components"
  category: string;        // e.g. "frontend" (matches parent folder name)
  description: string;     // What this module covers
  lastUpdated: string;     // ISO-8601
  files: TrackedFile[];    // Files this module documents
}

/** Parsed representation of a single .context/<category>/<module>.md file */
export interface ModuleFile {
  filePath: string;        // Absolute path to the .md file
  fileName: string;        // e.g. "components.md"
  category: string;        // Derived from parent folder name
  data: ModuleData;        // Parsed frontmatter
  body: string;            // Markdown body below ---
  parseError?: string;     // If parsing failed
}

/** Per-category grouping for the tree view */
export interface CategoryGroup {
  name: string;            // e.g. "frontend"
  modules: ModuleFile[];   // All modules in this category
}

/** Config file: .context/_config.json */
export interface ContextConfig {
  categories: string[];                // e.g. ["frontend", "backend", "shared", "assets"]
  excludePatterns: string[];           // Glob patterns to ignore during scanning
  scanRoots: string[];                 // Directories to scan, default ["src", "lib", "app"]
  sourceExtensions: string[];          // File extensions to track, e.g. [".ts", ".js", ".py"]
  categoryMap: Record<string, string>; // Directory name → category, e.g. {"components": "frontend"}
  needsAiSetup: boolean;              // True after fresh init — AI should adapt config to project type
}

/** Staleness info for a module */
export interface StalenessInfo {
  module: ModuleFile;
  staleFiles: string[];    // Paths of tracked files modified after lastUpdated
  isStale: boolean;
  isUndocumented: boolean; // Body still contains auto-generated [AI: ...] placeholder text
}
