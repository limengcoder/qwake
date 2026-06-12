#!/usr/bin/env node
import { Command } from "commander";
import {
  addTask,
  doctor,
  getWakeScheduleLogs,
  getWakeSchedules,
  initialize,
  installWakeSchedule,
  listTasks,
  probeAgent,
  removeWakeSchedule,
  resumeTask,
  runDue,
  runWrappedAgent,
  triggerWakeSchedule,
  wakeAgent
} from "./core.js";
import { DEFAULT_BUFFER_MINUTES, DEFAULT_WINDOW_MINUTES } from "./config.js";
import { getQwakeHome, getConfigPath } from "./paths.js";
import type { AgentName } from "./types.js";

const program = new Command();

program
  .name("qwake")
  .description("Local-first quota window waker for AI coding agents.")
  .version("0.1.0")
  .option("--verbose", "show extra diagnostic information");

program
  .command("init")
  .description("Create the default Qwake config.")
  .option("--force", "overwrite existing config")
  .action(async (options: { force?: boolean }) => {
    const configPath = await initialize(Boolean(options.force));
    console.log(`Qwake config ready: ${configPath}`);
  });

program
  .command("add")
  .description("[experimental] Manually add a task to the resume queue.")
  .requiredOption("-g, --goal <goal>", "task goal")
  .option("-a, --agent <agent>", "agent to use", "mock")
  .option("-p, --project <path>", "project path", process.cwd())
  .option("--retry-at <iso>", "ISO timestamp for retry time")
  .option("--state <state>", "current state")
  .option("--next-step <step>", "next step")
  .action(async (options) => {
    const task = await addTask({
      goal: options.goal,
      agent: parseAgent(options.agent),
      projectPath: options.project,
      retryAt: options.retryAt ? new Date(options.retryAt) : undefined,
      currentState: options.state,
      nextStep: options.nextStep
    });
    console.log(`Queued ${task.id}`);
    console.log(`Resume at: ${task.retryAt}`);
    console.log(`Resume file: ${task.resumePath}`);
  });

program
  .command("run")
  .description("[experimental] Run an agent task and queue it if a limit is detected.")
  .argument("<agent>", "codex, claude, mock, or custom")
  .argument("[agentArgs...]", "arguments passed to the underlying agent after --")
  .allowUnknownOption(true)
  .option("-g, --goal <goal>", "task goal", "Continue the current AI coding task.")
  .option("-p, --project <path>", "project path", process.cwd())
  .option("--limit", "mock mode: simulate a usage limit")
  .option("--fail", "mock mode: simulate a non-limit failure")
  .action(async (agentValue: string, agentArgs: string[], options) => {
    const agent = parseAgent(agentValue);
    const parsed = parseRunOptions(agentArgs, options);
    const { result, task } = await runWrappedAgent({
      agent,
      goal: parsed.goal,
      args: parsed.agentArgs,
      projectPath: parsed.project,
      mockMode: parsed.mockMode
    });
    if (task) {
      console.log(`\nLimit detected. Queued ${task.id} for ${task.retryAt}`);
      console.log(`Resume file: ${task.resumePath}`);
    }
    process.exitCode = task ? 0 : result.exitCode;
  });

program
  .command("probe")
  .description("Run a minimal live availability check for an agent.")
  .argument("<agent>", "codex, claude, mock, or custom")
  .option("-p, --project <path>", "project path", process.cwd())
  .option("--budget-usd <amount>", "optional Claude max budget for this live check")
  .option("--json", "print structured JSON output")
  .action(async (agentValue: string, options) => {
    const agent = parseAgent(agentValue);
    const startedAt = new Date();
    const result = await probeAgent({ agent, projectPath: options.project, budgetUsd: options.budgetUsd });
    const status = result.limited ? "limited" : result.exitCode === 0 ? "available" : "failed";
    printEvent({
      command: "probe",
      agent,
      status,
      startedAt,
      exitCode: result.exitCode,
      limited: result.limited,
      output: result.output,
      json: Boolean(options.json)
    });
    if (result.limited) {
      process.exitCode = 2;
      return;
    }
    process.exitCode = result.exitCode;
  });

program
  .command("wake")
  .description("Send one minimal user-triggered wake call to an agent.")
  .argument("<agent>", "codex, claude, mock, or custom")
  .option("-p, --project <path>", "project path", process.cwd())
  .option("--budget-usd <amount>", "optional Claude max budget for this wake call")
  .option("--smart", "skip the live wake if the previous successful wake is still inside the quota window")
  .option("--window-minutes <minutes>", "smart wake quota window length", String(DEFAULT_WINDOW_MINUTES))
  .option("--buffer-minutes <minutes>", "smart wake extra safety buffer", String(DEFAULT_BUFFER_MINUTES))
  .option("--timeout-seconds <seconds>", "hard timeout for the wake call")
  .option("--json", "print structured JSON output")
  .action(async (agentValue: string, options) => {
    const agent = parseAgent(agentValue);
    const startedAt = new Date();
    const result = await wakeAgent({
      agent,
      projectPath: options.project,
      budgetUsd: options.budgetUsd,
      smart: Boolean(options.smart),
      windowMinutes: parsePositiveInteger(options.windowMinutes, "window-minutes"),
      bufferMinutes: parsePositiveInteger(options.bufferMinutes, "buffer-minutes"),
      timeoutSeconds: parseStrictPositiveInteger(options.timeoutSeconds, "timeout-seconds")
    });
    const status = result.skipped ? "skipped" : result.limited ? "limited" : result.exitCode === 0 ? "success" : "failed";
    printEvent({
      command: "wake",
      agent,
      status,
      startedAt,
      exitCode: result.exitCode,
      limited: result.limited,
      timedOut: Boolean(result.timedOut),
      skipped: Boolean(result.skipped),
      lastSuccessAt: result.lastSuccessAt,
      nextWakeAt: result.nextWakeAt,
      smartWindowMinutes: result.smartWindowMinutes,
      bufferMinutes: result.bufferMinutes,
      output: result.output,
      json: Boolean(options.json)
    });
    if (result.limited) {
      process.exitCode = 2;
      return;
    }
    process.exitCode = result.exitCode;
  });

const schedule = program
  .command("schedule")
  .description("Install and inspect system wake schedules.");

schedule
  .command("install")
  .description("Install a macOS LaunchAgent wake schedule.")
  .argument("<agent>", "codex, claude, mock, or custom")
  .requiredOption("--times <times>", "comma-separated HH:mm times, e.g. 06:00,11:00,16:00,21:00")
  .option("--budget-usd <amount>", "optional Claude max budget for each wake call")
  .option("--no-smart", "disable smart window skipping for scheduled wakes")
  .option("--window-minutes <minutes>", "smart wake quota window length", String(DEFAULT_WINDOW_MINUTES))
  .option("--buffer-minutes <minutes>", "smart wake extra safety buffer", String(DEFAULT_BUFFER_MINUTES))
  .option("--timeout-seconds <seconds>", "hard timeout for each wake call")
  .option("--command <path>", "advanced: executable path for the scheduler")
  .action(async (agentValue: string, options) => {
    const agent = parseAgent(agentValue);
    const result = await installWakeSchedule({
      agent,
      times: String(options.times).split(","),
      budgetUsd: options.budgetUsd,
      command: options.command,
      smart: options.smart !== false,
      windowMinutes: parsePositiveInteger(options.windowMinutes, "window-minutes"),
      bufferMinutes: parsePositiveInteger(options.bufferMinutes, "buffer-minutes"),
      timeoutSeconds: parseStrictPositiveInteger(options.timeoutSeconds, "timeout-seconds")
    });
    console.log(`Installed ${result.label}`);
    console.log(`Times: ${result.times.join(", ")}`);
    console.log(`Plist: ${result.plistPath}`);
    console.log(`Logs: ${result.logPath}`);
  });

schedule
  .command("status")
  .description("Show installed wake schedules.")
  .argument("[agent]", "optional agent filter")
  .action(async (agentValue?: string) => {
    const schedules = await getWakeSchedules(agentValue ? parseAgent(agentValue) : undefined);
    if (schedules.length === 0) {
      console.log("No wake schedules installed.");
      return;
    }
    for (const item of schedules) {
      console.log(`${item.agent}  ${item.times.join(", ")}  ${item.label}`);
      console.log(`  ${item.plistPath}`);
    }
  });

schedule
  .command("uninstall")
  .description("Uninstall a wake schedule.")
  .argument("<agent>", "codex, claude, mock, or custom")
  .action(async (agentValue: string) => {
    const removed = await removeWakeSchedule(parseAgent(agentValue));
    if (!removed) {
      console.log("No wake schedule installed.");
      return;
    }
    console.log(`Uninstalled ${removed.label}`);
  });

schedule
  .command("logs")
  .description("Show wake schedule logs.")
  .argument("[agent]", "optional agent filter")
  .option("-n, --lines <count>", "number of lines to show", "50")
  .action(async (agentValue: string | undefined, options) => {
    const logs = await getWakeScheduleLogs(
      agentValue ? parseAgent(agentValue) : undefined,
      Number(options.lines)
    );
    console.log(logs || "No wake schedule logs found.");
  });

schedule
  .command("run")
  .description("Trigger an installed wake schedule once through launchd.")
  .argument("<agent>", "codex, claude, mock, or custom")
  .action(async (agentValue: string) => {
    const schedule = await triggerWakeSchedule(parseAgent(agentValue));
    console.log(`Triggered ${schedule.label}`);
    console.log(`Logs: ${schedule.logPath}`);
    console.log(`Errors: ${schedule.errorLogPath}`);
  });

program
  .command("status")
  .description("[experimental] Show queued tasks.")
  .action(async () => {
    const tasks = await listTasks();
    if (tasks.length === 0) {
      console.log("No tasks found.");
      return;
    }
    for (const task of tasks) {
      console.log(`${task.id}  ${task.status}  ${task.agent}  retry=${task.retryAt}`);
      console.log(`  ${task.goal}`);
    }
  });

program
  .command("resume")
  .description("[experimental] Resume a queued task.")
  .argument("<task>", "task id or 'next'")
  .option("-a, --agent <agent>", "override agent")
  .option("--limit", "mock mode: simulate a usage limit")
  .option("--fail", "mock mode: simulate a non-limit failure")
  .action(async (selector: string, options) => {
    const mockMode = options.limit ? "limit" : options.fail ? "fail" : "success";
    const { task, result } = await resumeTask({
      selector,
      agentOverride: options.agent ? parseAgent(options.agent) : undefined,
      mockMode
    });
    if (!task || !result) {
      console.log("No matching queued task found.");
      return;
    }
    console.log(`Resumed ${task.id}: exit=${result.exitCode} limited=${result.limited}`);
    process.exitCode = result.exitCode;
  });

program
  .command("due")
  .description("[experimental] List or run tasks whose retry time has arrived.")
  .option("--run", "run due tasks")
  .option("--limit", "mock mode: simulate a usage limit")
  .option("--fail", "mock mode: simulate a non-limit failure")
  .action(async (options) => {
    const mockMode = options.limit ? "limit" : options.fail ? "fail" : "success";
    const result = await runDue({ run: Boolean(options.run), mockMode });
    if (result.due.length === 0) {
      console.log("No due tasks.");
      return;
    }
    console.log(`Due tasks: ${result.due.length}`);
    for (const task of result.due) {
      console.log(`${task.id}  ${task.agent}  ${task.goal}`);
    }
    for (const item of result.ran) {
      console.log(`Ran ${item.task.id}: exit=${item.exitCode} limited=${item.limited}`);
    }
  });

program
  .command("doctor")
  .description("Check local Qwake configuration and agent commands.")
  .action(async () => {
    const opts = program.opts();
    const verbose = Boolean(opts.verbose);
    const checks = await doctor();
    for (const check of checks) {
      const status = check.available ? "ok" : "missing";
      console.log(`${check.agent}: ${status}${check.command ? ` (${check.command})` : ""}`);
    }
    if (verbose) {
      console.log(`\n  home: ${getQwakeHome()}`);
      console.log(`  config: ${getConfigPath()}`);
      console.log(`  node: ${process.version}`);
      console.log(`  platform: ${process.platform}`);
    }
  });

const normalizedArgv = process.argv[2] === "--"
  ? [process.argv[0] ?? "node", process.argv[1] ?? "qwake", ...process.argv.slice(3)]
  : process.argv;

program.parseAsync(normalizedArgv).catch((error: unknown) => {
  const opts = program.opts();
  if (opts.verbose && error instanceof Error && error.stack) {
    console.error(error.stack);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
});

function parseAgent(value: string): AgentName {
  if (value === "codex" || value === "claude" || value === "mock" || value === "custom") {
    return value;
  }
  throw new Error(`Unsupported agent "${value}". Use codex, claude, mock, or custom.`);
}

function printEvent(input: {
  command: "wake" | "probe";
  agent: AgentName;
  status: string;
  startedAt: Date;
  exitCode: number;
  limited: boolean;
  timedOut?: boolean;
  skipped?: boolean;
  lastSuccessAt?: string;
  nextWakeAt?: string;
  smartWindowMinutes?: number;
  bufferMinutes?: number;
  output: string;
  json: boolean;
}): void {
  const endedAt = new Date();
  const outputSummary = summarizeOutput(input.output);
  const localTimestamp = formatLocalTimestamp(endedAt);
  const event = {
    timestamp: endedAt.toISOString(),
    localTimestamp,
    command: input.command,
    agent: input.agent,
    status: input.status,
    exitCode: input.exitCode,
    limited: input.limited,
    timedOut: input.timedOut || undefined,
    skipped: input.skipped || undefined,
    lastSuccessAt: input.lastSuccessAt,
    nextWakeAt: input.nextWakeAt,
    smartWindowMinutes: input.smartWindowMinutes,
    bufferMinutes: input.bufferMinutes,
    durationMs: endedAt.getTime() - input.startedAt.getTime(),
    output: outputSummary || undefined
  };
  if (input.json) {
    console.log(JSON.stringify(event));
    return;
  }
  let line =
    `[${event.localTimestamp}] ${event.command} agent=${event.agent} status=${event.status} exitCode=${event.exitCode} limited=${event.limited} durationMs=${event.durationMs} utc=${event.timestamp}`
  if (event.timedOut) {
    line += " timedOut=true";
  }
  if (event.status === "skipped") {
    if (event.lastSuccessAt) {
      line += ` lastSuccessAt=${event.lastSuccessAt}`;
    }
    if (event.nextWakeAt) {
      line += ` nextWakeAt=${event.nextWakeAt}`;
    }
    if (event.smartWindowMinutes !== undefined) {
      line += ` windowMinutes=${event.smartWindowMinutes}`;
    }
    if (event.bufferMinutes !== undefined) {
      line += ` bufferMinutes=${event.bufferMinutes}`;
    }
  }
  if (event.output && event.status !== "success" && event.status !== "available") {
    line += ` output=${JSON.stringify(event.output)}`;
  }
  console.log(line);
}

function summarizeOutput(output: string, max = 240): string {
  const summary = output.replace(/\s+/g, " ").trim();
  if (!summary) {
    return "";
  }
  return summary.length <= max ? summary : `${summary.slice(0, max - 1)}…`;
}

function formatLocalTimestamp(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absoluteOffset / 60)).padStart(2, "0");
  const offsetRemainder = String(absoluteOffset % 60).padStart(2, "0");
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())} ${sign}${offsetHours}:${offsetRemainder}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function parsePositiveInteger(value: string | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`--${label} must be a non-negative integer.`);
  }
  return parsed;
}

function parseStrictPositiveInteger(value: string | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${label} must be a positive integer.`);
  }
  return parsed;
}

function parseRunOptions(
  agentArgs: string[],
  options: { goal: string; project: string; limit?: boolean; fail?: boolean }
): {
  agentArgs: string[];
  goal: string;
  project: string;
  mockMode: "success" | "limit" | "fail";
} {
  const passthrough: string[] = [];
  let goal = options.goal;
  let project = options.project;
  let limit = Boolean(options.limit);
  let fail = Boolean(options.fail);

  for (let index = 0; index < agentArgs.length; index += 1) {
    const arg = agentArgs[index];
    if (arg === "--limit") {
      limit = true;
      continue;
    }
    if (arg === "--fail") {
      fail = true;
      continue;
    }
    if ((arg === "--goal" || arg === "-g") && agentArgs[index + 1]) {
      goal = agentArgs[index + 1];
      index += 1;
      continue;
    }
    if ((arg === "--project" || arg === "-p") && agentArgs[index + 1]) {
      project = agentArgs[index + 1];
      index += 1;
      continue;
    }
    passthrough.push(arg);
  }

  return {
    agentArgs: passthrough,
    goal,
    project,
    mockMode: limit ? "limit" : fail ? "fail" : "success"
  };
}
