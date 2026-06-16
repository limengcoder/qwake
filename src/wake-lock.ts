import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { getQwakeHome } from "./paths.js";
import type { AgentName } from "./types.js";

export interface WakeLock {
  release: () => Promise<void>;
}

export async function acquireWakeLock(agent: AgentName, staleAfterMs: number): Promise<WakeLock | undefined> {
  const locksDir = path.join(getQwakeHome(), "locks");
  const lockPath = path.join(locksDir, `${agent}.lock`);
  await mkdir(locksDir, { recursive: true });

  const acquired = await tryCreateLock(lockPath);
  if (acquired) {
    return acquired;
  }

  if (await isStaleLock(lockPath, staleAfterMs)) {
    await rm(lockPath, { force: true });
    return tryCreateLock(lockPath);
  }

  return undefined;
}

async function tryCreateLock(lockPath: string): Promise<WakeLock | undefined> {
  try {
    const handle = await open(lockPath, "wx");
    await handle.writeFile(JSON.stringify({
      pid: process.pid,
      createdAt: new Date().toISOString()
    }));
    await handle.close();
    return {
      release: async () => {
        await rm(lockPath, { force: true });
      }
    };
  } catch (error) {
    if (isFileExistsError(error)) {
      return undefined;
    }
    throw error;
  }
}

async function isStaleLock(lockPath: string, staleAfterMs: number): Promise<boolean> {
  try {
    const [metadata, raw] = await Promise.all([
      stat(lockPath),
      readFile(lockPath, "utf8").catch(() => "")
    ]);
    const parsed = raw ? JSON.parse(raw) as { createdAt?: string } : {};
    const createdAt = parsed.createdAt ? new Date(parsed.createdAt).getTime() : metadata.mtimeMs;
    return Date.now() - createdAt > staleAfterMs;
  } catch {
    return true;
  }
}

function isFileExistsError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}
