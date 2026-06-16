import { mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import yaml from "js-yaml";
import { atomicWriteFile } from "./fs-utils.js";
import { getConfigPath, getQwakeHome, getTasksDir } from "./paths.js";
import type { QwakeConfig } from "./types.js";

export const DEFAULT_LIMIT_PATTERNS = [
  "usage limit",
  "rate limit",
  "try again later",
  "quota",
  "limit reached"
];

/** Default smart wake window: 5 hours */
export const DEFAULT_WINDOW_MINUTES = 300;

/** Default smart wake buffer after the window expires */
export const DEFAULT_BUFFER_MINUTES = 5;

/** Default hard timeout for live wake calls */
export const DEFAULT_WAKE_TIMEOUT_SECONDS = 120;

/** @deprecated Use DEFAULT_WAKE_TIMEOUT_SECONDS. */
export const DEFAULT_CODEX_WAKE_TIMEOUT_SECONDS = DEFAULT_WAKE_TIMEOUT_SECONDS;

export const DEFAULT_CONFIG: QwakeConfig = {
  version: 1,
  retryWindows: ["06:30", "11:30", "16:30", "21:30"],
  agents: {
    codex: {
      command: "codex",
      args: ["exec", "-"],
      limitPatterns: DEFAULT_LIMIT_PATTERNS
    },
    claude: {
      command: "claude",
      args: ["--print"],
      limitPatterns: [
        ...DEFAULT_LIMIT_PATTERNS,
        "claude usage limit"
      ]
    },
    mock: {
      command: "mock",
      args: [],
      limitPatterns: DEFAULT_LIMIT_PATTERNS
    },
    custom: {
      command: "",
      args: [],
      limitPatterns: DEFAULT_LIMIT_PATTERNS
    }
  }
};

export async function initConfig(options: { force?: boolean; home?: string } = {}): Promise<string> {
  const home = options.home || getQwakeHome();
  const configPath = getConfigPath(home);
  await mkdir(getTasksDir(home), { recursive: true });
  if (existsSync(configPath) && !options.force) {
    return configPath;
  }
  await atomicWriteFile(configPath, yaml.dump(DEFAULT_CONFIG, { lineWidth: 100 }));
  return configPath;
}

export async function loadConfig(home = getQwakeHome()): Promise<QwakeConfig> {
  const configPath = getConfigPath(home);
  if (!existsSync(configPath)) {
    await initConfig({ home });
  }
  const raw = await readFile(configPath, "utf8");
  const parsed = yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as QwakeConfig | undefined;
  return normalizeConfig(parsed);
}

function normalizeConfig(config: QwakeConfig | undefined): QwakeConfig {
  if (!config) {
    return DEFAULT_CONFIG;
  }
  return {
    version: 1,
    retryWindows: config.retryWindows?.length ? config.retryWindows : DEFAULT_CONFIG.retryWindows,
    agents: {
      codex: { ...DEFAULT_CONFIG.agents.codex, ...config.agents?.codex },
      claude: { ...DEFAULT_CONFIG.agents.claude, ...config.agents?.claude },
      mock: { ...DEFAULT_CONFIG.agents.mock, ...config.agents?.mock },
      custom: { ...DEFAULT_CONFIG.agents.custom, ...config.agents?.custom }
    }
  };
}
