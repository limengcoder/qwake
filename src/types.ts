export type AgentName = "codex" | "claude" | "mock" | "custom";

export type TaskStatus = "queued" | "running" | "completed" | "failed";

export interface AgentConfig {
  command: string;
  args?: string[];
  limitPatterns: string[];
}

export interface QwakeConfig {
  version: 1;
  retryWindows: string[];
  agents: Record<AgentName, AgentConfig>;
}

export interface Task {
  id: string;
  goal: string;
  agent: AgentName;
  projectPath: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  retryAt: string;
  resumePath: string;
  recentOutput: string;
  currentState: string;
  nextStep: string;
  attempts: number;
}

export interface CreateTaskInput {
  goal: string;
  agent: AgentName;
  projectPath: string;
  retryAt: Date;
  recentOutput?: string;
  currentState?: string;
  nextStep?: string;
}

export interface RunAgentResult {
  exitCode: number;
  output: string;
  limited: boolean;
  timedOut?: boolean;
  skipped?: boolean;
  lastSuccessAt?: string;
  nextWakeAt?: string;
  smartWindowMinutes?: number;
  bufferMinutes?: number;
}
