import { describe, expect, it } from "vitest";
import type { ShellRun } from "../shared/shell-run";
import { describeStatus, durationOf, formatDuration } from "./status";

const base = { command: "x", cwd: "/tmp", output: "", truncated: false, startedAt: 0 };

describe("describeStatus", () => {
  it("colors the exit code by success", () => {
    const exited = (exitCode: number): ShellRun => ({ ...base, state: "exited", exitCode, durationMs: 1 });
    expect(describeStatus(exited(0))).toEqual({ text: "exit 0", tone: "success" });
    expect(describeStatus(exited(3))).toEqual({ text: "exit 3", tone: "danger" });
  });

  it("names why a run was killed", () => {
    const killed = (reason: "canceled" | "timeout"): ShellRun => ({ ...base, state: "killed", reason, durationMs: 1 });
    expect(describeStatus(killed("canceled")).text).toBe("canceled");
    expect(describeStatus(killed("timeout")).text).toBe("timed out");
  });

  it("shows a failure message as is", () => {
    expect(describeStatus({ ...base, state: "failed", message: "spawn ENOENT" })).toEqual({
      text: "spawn ENOENT",
      tone: "danger",
    });
  });
});

describe("durationOf", () => {
  it("is only known once the run has ended", () => {
    expect(durationOf({ ...base, state: "running", runId: "r" })).toBeNull();
    expect(durationOf({ ...base, state: "exited", exitCode: 0, durationMs: 42 })).toBe(42);
  });
});

describe("formatDuration", () => {
  it("scales from milliseconds to hours", () => {
    expect(formatDuration(450)).toBe("450ms");
    expect(formatDuration(1234)).toBe("1.2s");
    expect(formatDuration(125_000)).toBe("2m 05s");
    expect(formatDuration(3_900_000)).toBe("1h 05m");
  });
});
