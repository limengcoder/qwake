import { homedir } from "node:os";
import path from "node:path";

export function getQwakeHome(): string {
  return process.env.QWAKE_HOME || path.join(homedir(), ".qwake");
}

export function getConfigPath(home = getQwakeHome()): string {
  return path.join(home, "config.yaml");
}

export function getTasksDir(home = getQwakeHome()): string {
  return path.join(home, "tasks");
}

export function getWakesDir(home = getQwakeHome()): string {
  return path.join(home, "wakes");
}
