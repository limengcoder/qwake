# Qwake

[English](README.md) | [简体中文](README.zh-CN.md)

Qwake is a local-first quota window waker for AI coding agents.

It sends a tiny, user-triggered wake message to a local AI coding CLI such as Claude Code, Codex, or a custom provider command. The goal is to help users start or verify provider quota windows without launching a full coding task.

Qwake does not bypass limits, manage credentials, upload source code, or require an official Claude/Codex account. It simply calls the agent command that already works on your machine. If your `claude` CLI is routed to GLM, OpenRouter, Bedrock, Vertex, or another provider, Qwake uses that existing setup.

## Install

For users:

```bash
npm install -g @sysiphus/qwake
qwake --help
```

For local development:

```bash
pnpm install
pnpm build
pnpm dev -- --help
```

For local testing before npm publish:

```bash
npm install -g .
qwake --help
```

## Quick Start Without Any Agent Login

Use the built-in mock agent:

```bash
pnpm dev -- init
pnpm dev -- doctor
pnpm dev -- wake mock
pnpm dev -- probe mock
```

Expected output:

```text
[2026-06-01 09:20:00 +08:00] wake agent=mock status=success exitCode=0 limited=false durationMs=1 utc=2026-06-01T01:20:00.000Z
[2026-06-01 09:20:01 +08:00] probe agent=mock status=available exitCode=0 limited=false durationMs=1 utc=2026-06-01T01:20:01.000Z
```

## Real-World Setup

This is the flow used during early local testing:

```bash
pnpm build
npm install -g .
which qwake
qwake doctor
qwake schedule install claude --times 06:05,11:10,16:15,21:20
qwake schedule status claude
qwake schedule run claude
qwake schedule logs claude
```

If you installed from npm, use the same commands without `npm install -g .`:

```bash
npm install -g @sysiphus/qwake
qwake doctor
qwake schedule install claude --times 06:05,11:10,16:15,21:20
```

## Wake Claude Code

Qwake wraps your installed `claude` command. It does not care whether Claude Code is using an official Anthropic account, an API key, or a third-party provider configured inside Claude Code.

```bash
qwake wake claude
```

If you want to pass Claude Code's optional budget guard:

```bash
qwake wake claude --budget-usd 0.10
```

By default Qwake does not set `--max-budget-usd`. That keeps it compatible with third-party provider plans where USD budget semantics may not match the actual quota system.

## Wake Codex

```bash
qwake wake codex
```

The default Codex wake command uses non-interactive `codex exec` with read-only sandboxing and no approval prompts.

## Custom Providers

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

## Token and Quota Behavior

```text
doctor      = zero token; checks local commands only
wake        = tiny live request; may spend a small amount of provider quota
wake --smart = tiny live request only when the local 5h+buffer guard is due
probe       = tiny live request; may spend a small amount of provider quota
```

Use `wake` when you intentionally want to start or verify a provider quota window.

## Scheduling

Qwake does not stay resident. Scheduling is handled by the operating system.

On macOS, Qwake can install a LaunchAgent:

```bash
qwake schedule install claude --times 06:05,11:10,16:15,21:20
qwake schedule status claude
qwake schedule run claude
qwake schedule logs claude
qwake schedule uninstall claude
```

The install command creates:

```text
~/Library/LaunchAgents/com.qwake.claude.plist
~/.qwake/logs/claude.log
~/.qwake/logs/claude.error.log
```

At each configured wall-clock time, launchd runs a smart tiny `qwake wake claude --smart` request. By default, scheduled wakes only call the provider when at least `5h + 5m` has passed since the last successful wake for that agent. If the previous successful wake is still inside that window, Qwake writes `status=skipped` and does not spend a live provider call.

You can tune the guard when installing:

```bash
qwake schedule install claude --times 06:05,11:10,16:15,21:20 --window-minutes 300 --buffer-minutes 5
```

Disable smart skipping only if you intentionally want every scheduled time to call the provider:

```bash
qwake schedule install claude --times 06:05,11:10,16:15,21:20 --no-smart
```

Qwake can attempt the wake and record the result, but it cannot guarantee provider quota refresh if the computer is off, fully asleep, offline, or the provider rejects the request.

To verify the installed LaunchAgent without waiting for the next clock time:

```bash
qwake schedule run claude
sleep 20
qwake schedule logs claude
```

Successful log entries look like this:

```text
[2026-06-01 09:20:00 +08:00] wake agent=claude status=success exitCode=0 limited=false durationMs=1842 utc=2026-06-01T01:20:00.000Z
```

`status=success` means the wake command completed. `status=limited` means Qwake detected a quota/rate-limit response. `status=failed` means the local command failed or the provider rejected the request.
`status=skipped` means smart mode intentionally avoided a live provider call because the last successful wake is still inside the configured window. The log includes `lastSuccessAt` and `nextWakeAt`.

On MacBooks, scheduled jobs may still run after closing the lid if macOS has not entered deep sleep yet, the machine briefly wakes, Power Nap or network wake is available, or external power is connected. Treat the log timestamp as the source of truth: it proves Qwake attempted the wake at that time, while the provider remains responsible for whether a quota window actually refreshed.

On macOS/Linux, cron can run Qwake at fixed wall-clock times:

```cron
5 6 * * * qwake wake claude --smart
10 11 * * * qwake wake claude --smart
15 16 * * * qwake wake claude --smart
20 21 * * * qwake wake claude --smart
```

Those cron entries use the same smart guard: if the previous successful wake is still inside `5h + 5m`, Qwake logs `status=skipped` and avoids the live provider call. If you specifically want every cron trigger to call the provider, omit `--smart`.

On macOS, launchd is usually more reliable than cron for laptop workflows because it can run after wake from sleep. Qwake's `schedule install` command uses launchd.

## Local Data

By default Qwake writes only to:

```text
~/.qwake/
  config.yaml
  wakes/
```

Wake and probe commands do not write into your project directory. Smart wake state is stored under `~/.qwake/wakes/<agent>.json`.

## Commands

```bash
qwake init
qwake doctor
qwake wake mock
qwake wake claude
qwake wake codex
qwake wake custom
qwake probe claude
qwake schedule install claude --times 06:05,11:10,16:15,21:20
qwake schedule status claude
qwake schedule run claude
qwake schedule logs claude
qwake schedule uninstall claude
```

## Project Status

This is an early open-source project. The first supported real CLIs are Codex and Claude Code, with `mock` and `custom` for no-login testing and provider experiments.
