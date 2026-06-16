import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { atomicWriteFile } from "./fs-utils.js";
import { DEFAULT_WAKE_TIMEOUT_SECONDS } from "./config.js";
import { getQwakeHome } from "./paths.js";
import type { AgentName } from "./types.js";
import { parseWindow } from "./windows.js";

export interface InstalledSchedule {
  agent: AgentName;
  label: string;
  plistPath: string;
  logPath: string;
  errorLogPath: string;
  times: string[];
}

export async function installSchedule(input: {
  agent: AgentName;
  times: string[];
  budgetUsd?: string;
  command?: string;
  cwd?: string;
  smart?: boolean;
  windowMinutes?: number;
  bufferMinutes?: number;
  timeoutSeconds?: number;
}): Promise<InstalledSchedule> {
  assertMacOS();
  const times = normalizeTimes(input.times);
  const schedule = getSchedulePaths(input.agent);
  const programArguments = buildProgramArguments({
    command: input.command,
    agent: input.agent,
    budgetUsd: input.budgetUsd,
    smart: input.smart ?? true,
    windowMinutes: input.windowMinutes,
    bufferMinutes: input.bufferMinutes,
    timeoutSeconds: input.timeoutSeconds ?? DEFAULT_WAKE_TIMEOUT_SECONDS
  });

  await mkdir(path.dirname(schedule.plistPath), { recursive: true });
  await mkdir(path.dirname(schedule.logPath), { recursive: true });

  const plist = renderLaunchAgentPlist({
    label: schedule.label,
    cwd: input.cwd || process.cwd(),
    programArguments,
    times,
    logPath: schedule.logPath,
    errorLogPath: schedule.errorLogPath,
    environment: buildLaunchEnvironment()
  });

  if (existsSync(schedule.plistPath)) {
    await unloadLaunchAgent(schedule.plistPath);
  }
  await atomicWriteFile(schedule.plistPath, plist);
  await loadLaunchAgent(schedule.plistPath);
  return {
    agent: input.agent,
    label: schedule.label,
    plistPath: schedule.plistPath,
    logPath: schedule.logPath,
    errorLogPath: schedule.errorLogPath,
    times
  };
}

export async function uninstallSchedule(agent: AgentName): Promise<InstalledSchedule | undefined> {
  assertMacOS();
  const schedule = getSchedulePaths(agent);
  if (!existsSync(schedule.plistPath)) {
    return undefined;
  }
  const times = await readScheduleTimes(schedule.plistPath);
  await unloadLaunchAgent(schedule.plistPath);
  await rm(schedule.plistPath, { force: true });
  return {
    agent,
    label: schedule.label,
    plistPath: schedule.plistPath,
    logPath: schedule.logPath,
    errorLogPath: schedule.errorLogPath,
    times
  };
}

export async function scheduleStatus(agent?: AgentName): Promise<InstalledSchedule[]> {
  assertMacOS();
  const agents: AgentName[] = agent ? [agent] : ["codex", "claude", "mock", "custom"];
  const schedules: InstalledSchedule[] = [];
  for (const item of agents) {
    const schedule = getSchedulePaths(item);
    if (!existsSync(schedule.plistPath)) {
      continue;
    }
    schedules.push({
      agent: item,
      label: schedule.label,
      plistPath: schedule.plistPath,
      logPath: schedule.logPath,
      errorLogPath: schedule.errorLogPath,
      times: await readScheduleTimes(schedule.plistPath)
    });
  }
  return schedules;
}

export async function readScheduleLogs(agent?: AgentName, lines = 50): Promise<string> {
  const agents: AgentName[] = agent ? [agent] : ["codex", "claude", "mock", "custom"];
  const chunks: string[] = [];
  for (const item of agents) {
    const schedule = getSchedulePaths(item);
    for (const file of [schedule.logPath, schedule.errorLogPath]) {
      if (!existsSync(file)) {
        continue;
      }
      const content = await readFile(file, "utf8");
      const tail = content.trim().split(/\r?\n/).slice(-lines).join("\n");
      if (tail) {
        chunks.push(`==> ${file}\n${tail}`);
      }
    }
  }
  return chunks.join("\n\n");
}

export async function runScheduleNow(agent: AgentName): Promise<InstalledSchedule> {
  assertMacOS();
  const schedules = await scheduleStatus(agent);
  const schedule = schedules[0];
  if (!schedule) {
    throw new Error(`No wake schedule installed for ${agent}.`);
  }
  await launchctl(["start", schedule.label]);
  return schedule;
}

export function normalizeTimes(times: string[]): string[] {
  const normalized = times.flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean);
  if (normalized.length === 0) {
    throw new Error("At least one time is required. Example: --times 06:00,11:00,16:00,21:00");
  }
  for (const time of normalized) {
    if (!parseWindow(time)) {
      throw new Error(`Invalid time "${time}". Use HH:mm, for example 06:00.`);
    }
  }
  return [...new Set(normalized)].sort();
}

function getSchedulePaths(agent: AgentName): Omit<InstalledSchedule, "agent" | "times"> {
  const label = `com.qwake.${agent}`;
  const logsDir = path.join(getQwakeHome(), "logs");
  return {
    label,
    plistPath: path.join(homedir(), "Library", "LaunchAgents", `${label}.plist`),
    logPath: path.join(logsDir, `${agent}.log`),
    errorLogPath: path.join(logsDir, `${agent}.error.log`)
  };
}

function buildProgramArguments(input: {
  command?: string;
  agent: AgentName;
  budgetUsd?: string;
  smart?: boolean;
  windowMinutes?: number;
  bufferMinutes?: number;
  timeoutSeconds?: number;
}): string[] {
  const base = input.command
    ? [input.command]
    : [process.execPath, process.argv[1] || path.resolve("dist/cli.js")];
  const args = [...base, "wake", input.agent];
  if (input.smart) {
    args.push("--smart");
  }
  if (input.windowMinutes !== undefined) {
    args.push("--window-minutes", String(input.windowMinutes));
  }
  if (input.bufferMinutes !== undefined) {
    args.push("--buffer-minutes", String(input.bufferMinutes));
  }
  if (input.timeoutSeconds !== undefined) {
    args.push("--timeout-seconds", String(input.timeoutSeconds));
  }
  if (input.budgetUsd) {
    args.push("--budget-usd", input.budgetUsd);
  }
  return args;
}

function buildLaunchEnvironment(): Record<string, string> {
  return {
    PATH: process.env.PATH || "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: homedir(),
    SHELL: process.env.SHELL || "/bin/zsh"
  };
}

function renderLaunchAgentPlist(input: {
  label: string;
  cwd: string;
  programArguments: string[];
  times: string[];
  logPath: string;
  errorLogPath: string;
  environment: Record<string, string>;
}): string {
  const intervals = input.times.map((time) => {
    const parsed = parseWindow(time);
    if (!parsed) {
      throw new Error(`Invalid time "${time}".`);
    }
    return `    <dict>
      <key>Hour</key>
      <integer>${parsed.hour}</integer>
      <key>Minute</key>
      <integer>${parsed.minute}</integer>
    </dict>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(input.label)}</string>
  <key>WorkingDirectory</key>
  <string>${escapeXml(input.cwd)}</string>
  <key>ProgramArguments</key>
  <array>
${input.programArguments.map((arg) => `    <string>${escapeXml(arg)}</string>`).join("\n")}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(input.environment).map(([key, value]) => `    <key>${escapeXml(key)}</key>
    <string>${escapeXml(value)}</string>`).join("\n")}
  </dict>
  <key>StartCalendarInterval</key>
  <array>
${intervals}
  </array>
  <key>StandardOutPath</key>
  <string>${escapeXml(input.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(input.errorLogPath)}</string>
</dict>
</plist>
`;
}

async function readScheduleTimes(plistPath: string): Promise<string[]> {
  const content = await readFile(plistPath, "utf8");
  const matches = [...content.matchAll(/<key>Hour<\/key>\s*<integer>(\d+)<\/integer>\s*<key>Minute<\/key>\s*<integer>(\d+)<\/integer>/g)];
  return matches.map((match) => `${match[1].padStart(2, "0")}:${match[2].padStart(2, "0")}`);
}

async function loadLaunchAgent(plistPath: string): Promise<void> {
  await launchctl(["load", plistPath]);
}

async function unloadLaunchAgent(plistPath: string): Promise<void> {
  await launchctl(["unload", plistPath], true);
}

function launchctl(args: string[], ignoreFailure = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("launchctl", args, { stdio: "ignore" });
    child.on("error", (error) => {
      if (ignoreFailure) {
        resolve();
      } else {
        reject(error);
      }
    });
    child.on("close", (code) => {
      if (code === 0 || ignoreFailure) {
        resolve();
      } else {
        reject(new Error(`launchctl ${args.join(" ")} failed with exit code ${code}.`));
      }
    });
  });
}

function assertMacOS(): void {
  if (process.platform !== "darwin") {
    throw new Error("schedule install is currently implemented for macOS LaunchAgent only.");
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
