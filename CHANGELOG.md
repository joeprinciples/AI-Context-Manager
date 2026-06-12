# Changelog

## 0.2.0

- **Fix:** A UTF-8 BOM no longer breaks parsing of module files or `_config.json` (PowerShell's `utf8` encoding writes one; affected files were reported as malformed, and a BOM'd config silently fell back to defaults). Files heal on next save.
- **Fix:** Dotfiles are now always excluded from project scans, even when `excludePatterns` is empty
- **Fix:** Removed `retainContextWhenHidden` from the panel for better stability in some VS Code forks; tree expand state is kept via the webview state API instead
- **Fix:** Template refresh re-validates both markers before writing
- **Fix:** Onboarding prompts appear one at a time rather than stacking
- **New:** Template versioning - existing installs are offered a one-click refresh of their CLAUDE.md block when the shipped template is newer

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

