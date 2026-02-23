# Changelog

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
