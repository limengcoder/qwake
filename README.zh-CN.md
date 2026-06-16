# Qwake

[English](README.md) | [简体中文](README.zh-CN.md)

一个 local-first 的 AI 编码工具额度窗口唤醒器，支持 Claude Code、Codex 和自定义 CLI provider。

Qwake 会通过你本机已经可用的 agent 命令发送一次极小的 wake 请求。它不绕过 provider 限制，不管理账号凭证，不上传源码，也不要求你使用某个官方账号。

## 安装

```bash
npm install -g @sysiphus/qwake
qwake --help
```

需要 Node.js 20 或更高版本。

## 快速开始

检查本机环境：

```bash
qwake doctor
```

手动唤醒一次 agent：

```bash
qwake wake claude
qwake wake codex
```

安装 macOS 每日定时任务：

```bash
qwake schedule install codex --times 06:05,11:10,16:15,21:20
qwake schedule status codex
qwake schedule logs codex
```

如果暂时没有登录任何 agent，可以用内置 mock agent 测试：

```bash
qwake wake mock
qwake probe mock
```

## 常用命令

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

## 定时唤醒

Qwake 自己不常驻后台。定时由操作系统负责。

在 macOS 上，`schedule install` 会创建 LaunchAgent：

```bash
qwake schedule install claude --times 06:05,11:10,16:15,21:20
```

定时任务默认使用 smart wake。只有当距离该 agent 上一次成功 wake 至少过去 `5 小时 + 5 分钟` 后，Qwake 才会真的调用 provider。否则会记录 `status=skipped`，避免消耗 live request。

Qwake 还会为每个 agent 保留一个 wake lock。如果同一个 agent 的 wake 已经在运行，重复 wake 会被跳过，不会再次调用 provider。

调整 smart 窗口：

```bash
qwake schedule install claude --times 06:05,11:10,16:15,21:20 --window-minutes 300 --buffer-minutes 5
```

只有当你明确希望每个定时点都调用 provider 时，才关闭 smart skipping：

```bash
qwake schedule install claude --times 06:05,11:10,16:15,21:20 --no-smart
```

定时 wake 默认带 120 秒硬超时：

```bash
qwake schedule install codex --times 06:05,11:10,16:15,21:20 --timeout-seconds 120
```

## Agents

### Claude Code

Qwake 会调用你本机安装的 `claude` 命令：

```bash
qwake wake claude
```

可选 Claude Code 预算保护：

```bash
qwake wake claude --budget-usd 0.10
```

默认情况下，Qwake 不会设置 `--max-budget-usd`，这样可以兼容第三方 provider plan，因为它们的美元预算语义可能和实际额度系统并不一致。

### Codex

```bash
qwake wake codex
```

默认 Codex wake 命令使用非交互的 `codex exec`，启用只读 sandbox、临时会话、跳过项目 git 检查，并忽略用户配置。wake 默认还有 120 秒硬超时，避免 CLI 卡住后阻塞后续定时窗口。

调整超时时间：

```bash
qwake wake codex --timeout-seconds 120
```

### 自定义 Provider

编辑 `~/.qwake/config.yaml`：

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

然后运行：

```bash
qwake wake custom
```

## 日志

查看定时任务日志：

```bash
qwake schedule logs codex
```

日志状态含义：

```text
success = wake 命令完成
limited = Qwake 检测到了额度或 rate limit 响应
failed  = 本地命令失败、超时或被 provider 拒绝
skipped = smart mode 判断上一次成功 wake 仍在配置窗口内，因此跳过 live call
```

超时命令使用退出码 `124`，日志里会带 `timedOut=true`。默认 wake 超时时间是 120 秒，可以用 `--timeout-seconds` 覆盖。
如果同一个 agent 已经有 wake 在运行，Qwake 会记录 `status=skipped`。

## 补充说明

`doctor` 只检查本地命令，不消耗 provider 额度。`wake`、`wake --smart` 和 `probe` 可能会发送极小 live request，因此可能消耗少量 provider 额度。

Qwake 能保证的是尝试唤醒并记录结果，不能保证 provider 一定刷新额度。如果电脑关机、完全深度睡眠、断网，或 provider 拒绝请求，唤醒可能失败。

在 macOS 笔记本上，launchd 通常比 cron 更适合睡眠后的长期使用。对于深度睡眠或关机状态，需要另外配置系统级唤醒，例如 `pmset`。

在 macOS/Linux 上，也可以用 cron 固定时间运行 Qwake：

```cron
5 6 * * * qwake wake claude --smart
10 11 * * * qwake wake claude --smart
15 16 * * * qwake wake claude --smart
20 21 * * * qwake wake claude --smart
```

`--timeout-seconds` 对直接 `wake` 命令是跨平台的，也适用于 cron、systemd timer 和 Windows Task Scheduler wrapper。

## 本地数据

默认情况下，Qwake 只写入：

```text
~/.qwake/
  config.yaml
  wakes/
  logs/
```

`wake` 和 `probe` 命令不会写入你的项目目录。Smart wake 状态会保存在 `~/.qwake/wakes/<agent>.json`。

## 开发

```bash
pnpm install
pnpm build
pnpm test
pnpm dev -- --help
```

发布到 npm 前的本地全局测试：

```bash
npm install -g .
qwake --help
```

## 项目状态

这是一个早期开源项目。第一批真实 CLI 支持 Codex 和 Claude Code，同时提供 `mock` 和 `custom` 用于免登录测试和 provider 实验。
