import { describe, expect, it } from "vitest";
import { runAgent } from "../src/agent-runner.js";

describe("agent runner", () => {
  it("terminates commands that exceed the timeout", async () => {
    const result = await runAgent({
      agent: "custom",
      config: {
        command: process.execPath,
        args: ["-e", "setTimeout(() => {}, 10000)"],
        limitPatterns: []
      },
      timeoutSeconds: 0.05,
      quiet: true
    });

    expect(result.exitCode).toBe(124);
    expect(result.timedOut).toBe(true);
    expect(result.output).toContain("Timed out after 0.05 seconds.");
  });
});
