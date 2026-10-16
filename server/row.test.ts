import { describe, expect, it } from "vitest";
import { shellRunSchema } from "../shared/shell-run";
import { buildRow, statusAfterExit } from "./row";

const meta = { command: "x", cwd: "/tmp", startedAt: 1 };

describe("statusAfterExit", () => {
  it("reports the exit code", () => {
    expect(statusAfterExit({ code: 3, signal: null, stopReason: null, durationMs: 5 })).toEqual({
      state: "exited",
      exitCode: 3,
      durationMs: 5,
    });
  });

  it("reports a signal nobody asked for as 128 plus the signal number", () => {
    const status = statusAfterExit({ code: null, signal: "SIGKILL", stopReason: null, durationMs: 5 });
    expect(status).toMatchObject({ state: "exited", exitCode: 137 });
  });

  it("reports a requested stop as killed whatever the exit code", () => {
    expect(
      statusAfterExit({ code: 143, signal: null, stopReason: "timeout", durationMs: 5 }),
    ).toEqual({ state: "killed", reason: "timeout", durationMs: 5 });
  });
});

describe("buildRow", () => {
  it("produces rows the renderer schema accepts", () => {
    const row = buildRow(meta, { output: "hi", truncated: false }, { state: "running", runId: "r" });
    expect(shellRunSchema.parse(row)).toEqual(row);
  });

  it("drops more of the head when serialized output is larger than its text", () => {
    // Each control byte serializes as a 6 byte \u escape, so 48 KiB of them is far over 64 KiB.
    const output = "\x07".repeat(48 * 1024) + "tail";
    const row = buildRow(meta, { output, truncated: false }, { state: "failed", message: "m" });
    expect(Buffer.byteLength(JSON.stringify(row))).toBeLessThan(64 * 1024);
    expect(row.truncated).toBe(true);
    expect(row.output.endsWith("tail")).toBe(true);
  });
});
