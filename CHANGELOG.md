# Changelog

## 0.1.0 (2026-06-01)

Initial release.

### CLI

- `qwake init` — create default config at `~/.qwake/config.yaml`
- `qwake doctor` — check local agent command availability
- `qwake wake <agent>` — send a tiny wake call to Claude Code, Codex, mock, or a custom CLI
- `qwake probe <agent>` — run a minimal availability check
- `qwake schedule install <agent> --times <HH:mm,...>` — install macOS LaunchAgent schedules with smart skipping
- `qwake schedule status`, `logs`, `run`, `uninstall` — inspect and manage schedules
- `--smart` flag with configurable `--window-minutes` (default 300) and `--buffer-minutes` (default 5)
- `--verbose` flag for extra diagnostic output on `doctor` and error stack traces
- `--json` flag on `wake` and `probe` for structured output
- Built-in `mock` agent for testing without any provider login
- `custom` agent via `~/.qwake/config.yaml`

### Scheduling

- macOS LaunchAgent with automatic plist generation and smart wake guard
- Linux cron/systemd and Windows Task Scheduler documented in blog guide (manual setup)

### Website

- Astro static site deployed at [qwake.top](https://qwake.top)
- English and simplified Chinese
- JSON-LD structured data (SoftwareApplication, FAQPage, HowTo, BlogPosting)
- OG social sharing images, sitemap, robots.txt, llms.txt
- CSS-only responsive hamburger menu
- Skip-to-content link and focus-visible styles for accessibility

### Publishing

- npm package: [@sysiphus/qwake](https://www.npmjs.com/package/@sysiphus/qwake)
- GitHub repository: [jiangqiusuo/qwake](https://github.com/jiangqiusuo/qwake)
- License: Apache-2.0
