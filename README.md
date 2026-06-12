# Qwake

[English](README.md) | [简体中文](README.zh-CN.md)

Local-first quota window waker for AI coding agents such as Claude Code, Codex, and custom CLI providers.

Qwake sends a tiny wake request through the agent command that already works on your machine. It does not bypass provider limits, manage credentials, upload source code, or require a specific official account.

## Install

```bash
npm install -g @sysiphus/qwake
qwake --help
```

Requires Node.js 20 or newer.

## Quick Start

Check your local setup:

```bash
qwake doctor
```

Wake an agent once:

```bash
qwake wake claude
qwake wake codex
```

Install a daily macOS schedule:

```bash
qwake schedule install codex --times 06:05,11:10,16:15,21:20
qwake schedule status codex
qwake schedule logs codex
```

Test without any agent login by using the built-in mock agent:

```bash
qwake wake mock
qwake probe mock
```

## Common Commands

```bash
qwake init
qwake doctor
qwake wake claude
qwake wake codex --timeout-seconds 120
qwake wake custom
qwake probe claude
qwake schedule install codex --times 06:05,11:10,16:15,21:20
qwake schedule status codex
qwake schedule run codex
qwake schedule logs codex
qwake schedule uninstall codex
```

## Scheduling

Qwake does not stay resident. Scheduling is handled by the operating system.

On macOS, `schedule install` creates a LaunchAgent:

```bash
qwake schedule install claude --times 06:05,11:10,16:15,21:20
```

The schedule runs a smart wake by default. It only calls the provider when at least `5h + 5m` has passed since the last successful wake for that agent. Otherwise Qwake logs `status=skipped` and avoids spending a live request.

Tune the smart window:

```bash
qwake schedule install claude --times 06:05,11:10,16:15,21:20 --window-minutes 300 --buffer-minutes 5
```

Disable smart skipping only when every scheduled time should call the provider:

```bash
qwake schedule install claude --times 06:05,11:10,16:15,21:20 --no-smart
```

Codex schedules include a 120-second hard timeout by default:

```bash
qwake schedule install codex --times 06:05,11:10,16:15,21:20 --timeout-seconds 120
```

## Agents

### Claude Code

Qwake wraps your installed `claude` command:

```bash
qwake wake claude
```

Optional Claude Code budget guard:

```bash
qwake wake claude --budget-usd 0.10
```

By default Qwake does not set `--max-budget-usd`, which keeps it compatible with third-party provider plans where USD budget semantics may not match the actual quota system.

### Codex

```bash
qwake wake codex
```

The default Codex wake command uses non-interactive `codex exec` with read-only sandboxing, ephemeral sessions, skipped project-git checks, and ignored user config. Codex wake calls have a 120-second hard timeout by default so a stuck CLI process cannot block later schedule windows.

Tune the timeout:

```bash
qwake wake codex --timeout-seconds 120
```

### Custom Providers

Edit `~/.qwake/config.yaml`:

```yaml
agents:
  custom:
    command: your-ai-cli
    args: ["--print"]
    limitPatterns:
      - usage limit
      - rate limit
      - quota
```

Then run:

```bash
qwake wake custom
```

## Logs

View schedule logs:

```bash
qwake schedule logs codex
```

Log status meanings:

```text
success = the wake command completed
limited = Qwake detected a quota or rate-limit response
failed  = the local command failed, timed out, or was rejected
skipped = smart mode avoided a live call because the previous success is still inside the configured window
```

Timed out commands use exit code `124` and include `timedOut=true`.

## Notes

`doctor` only checks local commands and does not spend provider quota. `wake`, `wake --smart`, and `probe` may send a tiny live request and can spend a small amount of provider quota.

Qwake can attempt the wake and record the result, but it cannot guarantee a provider quota refresh if the computer is off, fully asleep, offline, or the provider rejects the request.

On macOS laptops, launchd is usually more reliable than cron after sleep. For deep sleep or powered-off machines, configure a system wake event separately, for example with `pmset`.

On macOS/Linux, cron can also run Qwake:

```cron
5 6 * * * qwake wake claude --smart
10 11 * * * qwake wake claude --smart
15 16 * * * qwake wake claude --smart
20 21 * * * qwake wake claude --smart
```

The `--timeout-seconds` option is cross-platform for direct `wake` commands, including cron, systemd timers, and Windows Task Scheduler wrappers.

## Local Data

By default Qwake writes only to:

```text
~/.qwake/
  config.yaml
  wakes/
  logs/
```

Wake and probe commands do not write into your project directory. Smart wake state is stored under `~/.qwake/wakes/<agent>.json`.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm dev -- --help
```

For local global testing before npm publish:

```bash
npm install -g .
qwake --help
```

## Project Status

This is an early open-source project. The first supported real CLIs are Codex and Claude Code, with `mock` and `custom` for no-login testing and provider experiments.
