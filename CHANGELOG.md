# Changelog

## 0.1.1

- **Fix:** Re-init now cleans up old modules and directories before re-scanning
- **Fix:** Re-init dialog clarified to "Replace modules with a fresh scan?"
- **Fix:** Path validation on all webview message handlers (traversal prevention)
- **Fix:** `openSourceFile` now resolves relative paths against workspace root
- **Fix:** Per-file debounce prevents event loss when multiple files change simultaneously
- **Fix:** Staleness uses module file mtime as floor — prevents false positives after AI updates
- **Fix:** `_overview.md` no longer appears as a ghost module in tree after init
- **Fix:** Removed dead exports (`addFileToModule`, `isOverviewUndocumented`)
- **Fix:** Deduplicated default category map and source extensions (single source of truth)
- **Fix:** Removed unused `stalenessThresholdDays` setting
- Clickable module filename hint on far right of module rows
- Friendlier init button text: "Scan project and create documentation"
- Extracted reusable `showContextMenu()` helper in webview
- Package size reduced from 67 KB to 41 KB

## 0.1.0

- Initial release
- Per-project `.context/` folder with categorised module files
- Auto-scan project structure and create documentation scaffolding
- `_overview.md` project summary with AI placeholder prompts
- Staleness tracking — flags modules when source files change
- Tree view UI with categories, modules, and tracked files
- CLAUDE.md auto-injection for AI assistant integration
- `.claude/commands/` slash commands for Claude Code
- Configurable file extensions, category mappings, and scan roots via `_config.json`
- `needsAiSetup` flag for AI to adapt config to any project type
- Status bar indicator showing module count and staleness
