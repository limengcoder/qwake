import { cwd } from "node:process";
import {
  DEFAULT_BUFFER_MINUTES,
  DEFAULT_CODEX_WAKE_TIMEOUT_SECONDS,
  DEFAULT_WINDOW_MINUTES,
  initConfig,
  loadConfig
} from "./config.js";
import { TaskStore } from "./task-store.js";
import { nextRetryTime } from "./windows.js";
import { commandExists, runAgent, runResumeTask } from "./agent-runner.js";
import {
  installSchedule,
  readScheduleLogs,
  runScheduleNow,
  scheduleStatus,
  uninstallSchedule
} from "./scheduler.js";
import { getSmartWakeDecision, recordWakeSuccess } from "./wake-state.js";
import type { RunAgentResult } from "./types.js";
import type { AgentName, Task } from "./types.js";

export async function initialize(force = false): Promise<string> {
  return initConfig({ force });
}

export async function addTask(input: {
  goal: string;
  agent: AgentName;
  projectPath?: string;
  retryAt?: Date;
  recentOutput?: string;
  currentState?: string;
  nextStep?: string;
}): Promise<Task> {
  const config = await loadConfig();
  const store = new TaskStore();
  return store.create({
    goal: input.goal,
    agent: input.agent,
    projectPath: input.projectPath || cwd(),
    retryAt: input.retryAt || nextRetryTime(config.retryWindows),
    recentOutput: input.recentOutput,
    currentState: input.currentState,
    nextStep: input.nextStep
  });
}

export async function runWrappedAgent(input: {
  agent: AgentName;
  goal: string;
  args?: string[];
  projectPath?: string;
  mockMode?: "success" | "limit" | "fail";
}): Promise<{ result: Awaited<ReturnType<typeof runAgent>>; task?: Task }> {
  const config = await loadConfig();
  const agentConfig = config.agents[input.agent];
  const result = await runAgent({
    agent: input.agent,
    config: agentConfig,
    args: input.args,
    cwd: input.projectPath || cwd(),
    input: input.goal,
    mockMode: input.mockMode
  });

  if (!result.limited) {
    return { result };
  }

  const store = new TaskStore();
  const task = await store.create({
    goal: input.goal,
    agent: input.agent,
    projectPath: input.projectPath || cwd(),
    retryAt: nextRetryTime(config.retryWindows),
    recentOutput: trimOutput(result.output),
    currentState: "The agent stopped after hitting a usage or rate limit.",
    nextStep: "Resume the task from the captured output and continue the original goal."
  });
  return { result, task };
}

export async function probeAgent(input: {
  agent: AgentName;
  projectPath?: string;
  budgetUsd?: string;
}): Promise<RunAgentResult> {
  const config = await loadConfig();
  const agentConfig = config.agents[input.agent];
  return runAgent({
    agent: input.agent,
    config: {
      ...agentConfig,
      args: getProbeArgs(input.agent, input.budgetUsd)
    },
    cwd: input.projectPath || cwd(),
    input: `Reply with exactly: OK ${wakeNonce()}. Do not inspect files, run tools, or continue any coding task.`,
    mockMode: "success",
    quiet: true
  });
}

export async function wakeAgent(input: {
  agent: AgentName;
  projectPath?: string;
  budgetUsd?: string;
  smart?: boolean;
  windowMinutes?: number;
  bufferMinutes?: number;
  timeoutSeconds?: number;
}): Promise<RunAgentResult> {
  const windowMinutes = input.windowMinutes ?? DEFAULT_WINDOW_MINUTES;
  const bufferMinutes = input.bufferMinutes ?? DEFAULT_BUFFER_MINUTES;
  const timeoutSeconds = input.timeoutSeconds ?? (input.agent === "codex" ? DEFAULT_CODEX_WAKE_TIMEOUT_SECONDS : undefined);
  if (input.smart) {
    const decision = await getSmartWakeDecision({
      agent: input.agent,
      windowMinutes,
      bufferMinutes
    });
    if (!decision.shouldRun) {
      return {
        exitCode: 0,
        output: "Smart wake skipped because the previous successful wake is still inside the configured quota window.",
        limited: false,
        skipped: true,
        lastSuccessAt: decision.lastSuccessAt,
        nextWakeAt: decision.nextWakeAt,
        smartWindowMinutes: windowMinutes,
        bufferMinutes
      };
    }
  }

  const config = await loadConfig();
  const agentConfig = config.agents[input.agent];
  const result = await runAgent({
    agent: input.agent,
    config: {
      ...agentConfig,
      args: getProbeArgs(input.agent, input.budgetUsd)
    },
    cwd: input.projectPath || cwd(),
    input: `Reply exactly: QWAKE_OK ${wakeNonce()}. Do not inspect files, run tools, or continue any coding task.`,
    mockMode: "success",
    quiet: true,
    timeoutSeconds
  });
  if (result.exitCode === 0 && !result.limited) {
    const state = await recordWakeSuccess(input.agent);
    return {
      ...result,
      lastSuccessAt: state.lastSuccessAt,
      smartWindowMinutes: input.smart ? windowMinutes : undefined,
      bufferMinutes: input.smart ? bufferMinutes : undefined
    };
  }
  return result;
}

export async function listTasks(): Promise<Task[]> {
  return new TaskStore().list();
}

export async function resumeTask(input: {
  selector: string;
  agentOverride?: AgentName;
  mockMode?: "success" | "limit" | "fail";
}): Promise<{ task?: Task; result?: Awaited<ReturnType<typeof runResumeTask>> }> {
  const config = await loadConfig();
  const store = new TaskStore();
  const task = input.selector === "next" ? await store.nextQueued() : await store.get(input.selector);
  if (!task) {
    return {};
  }
  const agent = input.agentOverride || task.agent;
  const running = await store.update(task, { status: "running", attempts: task.attempts + 1 });
  const result = await runResumeTask(
    { ...running, agent },
    config.agents[agent],
    [],
    input.mockMode
  );
  await store.update(running, {
    status: result.exitCode === 0 && !result.limited ? "completed" : result.limited ? "queued" : "failed",
    recentOutput: trimOutput(result.output)
  });
  return { task: running, result };
}

export async function runDue(input: { run: boolean; mockMode?: "success" | "limit" | "fail" }): Promise<{
  due: Task[];
  ran: Array<{ task: Task; exitCode: number; limited: boolean }>;
}> {
  const store = new TaskStore();
  const due = await store.due();
  const ran: Array<{ task: Task; exitCode: number; limited: boolean }> = [];
  if (!input.run) {
    return { due, ran };
  }
  for (const task of due) {
    const result = await resumeTask({ selector: task.id, mockMode: input.mockMode });
    if (result.task && result.result) {
      ran.push({ task: result.task, exitCode: result.result.exitCode, limited: result.result.limited });
    }
  }
  return { due, ran };
}

export async function doctor(): Promise<Array<{ agent: AgentName; command: string; available: boolean }>> {
  const config = await loadConfig();
  const agents: AgentName[] = ["codex", "claude", "mock", "custom"];
  return Promise.all(
    agents.map(async (agent) => ({
      agent,
      command: config.agents[agent].command,
      available: agent === "mock" || (await commandExists(config.agents[agent].command))
    }))
  );
}

export async function installWakeSchedule(input: {
  agent: AgentName;
  times: string[];
  budgetUsd?: string;
  command?: string;
  smart?: boolean;
  windowMinutes?: number;
  bufferMinutes?: number;
  timeoutSeconds?: number;
}) {
  return installSchedule(input);
}

export async function getWakeSchedules(agent?: AgentName) {
  return scheduleStatus(agent);
}

export async function removeWakeSchedule(agent: AgentName) {
  return uninstallSchedule(agent);
}

export async function getWakeScheduleLogs(agent?: AgentName, lines?: number) {
  return readScheduleLogs(agent, lines);
}

export async function triggerWakeSchedule(agent: AgentName) {
  return runScheduleNow(agent);
}

function trimOutput(output: string, max = 4000): string {
  if (output.length <= max) {
    return output;
  }
  return output.slice(output.length - max);
}

function getProbeArgs(agent: AgentName, budgetUsd?: string): string[] {
  if (agent === "claude") {
    const args = [
      "--print",
      "--no-session-persistence",
      "--tools",
      ""
    ];
    if (budgetUsd) {
      args.push("--max-budget-usd", budgetUsd);
    }
    return args;
  }
  if (agent === "codex") {
    return [
      "exec",
      "--ignore-user-config",
      "--sandbox",
      "read-only",
      "--ephemeral",
      "--skip-git-repo-check",
      "-"
    ];
  }
  return [];
}

function wakeNonce(): string {
  return new Date().toISOString();
}
