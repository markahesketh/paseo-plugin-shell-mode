import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ShellRun } from "../shared/shell-run";
import { startShellRun } from "./run-shell";

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "shell-mode-"));
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

// Appends take a random moment, as a real round trip to the daemon would.
function collect() {
  const rows: ShellRun[] = [];
  const append = async (row: ShellRun) => {
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 20));
    rows.push(row);
  };
  return { rows, append };
}

async function run(command: string, options: Partial<Parameters<typeof startShellRun>[0]> = {}) {
  const { rows, append } = collect();
  const handle = startShellRun({ runId: "run-1", command, cwd, append, ...options });
  await handle.started;
  await handle.done;
  return { rows, last: rows[rows.length - 1]!, handle };
}

describe("startShellRun", () => {
  it("runs a command, interleaves stdout and stderr, and ends with the exit code", async () => {
    const { rows, last } = await run("printf a; sleep 0.1; printf b >&2; exit 3");
    expect(rows[0]).toMatchObject({ state: "running", runId: "run-1", output: "" });
    expect(rows.slice(0, -1).every((row) => row.state === "running")).toBe(true);
    expect(last).toMatchObject({ state: "exited", exitCode: 3, output: "ab", truncated: false, cwd });
  });

  it("runs in the given directory with git prompts disabled", async () => {
    const { last } = await run('pwd; echo "$GIT_EDITOR $GIT_TERMINAL_PROMPT"');
    expect(last).toMatchObject({ state: "exited", exitCode: 0 });
    expect(last.output).toContain("shell-mode-");
    expect(last.output).toContain("true 0");
  });

  it("keeps only the tail of large output", async () => {
    const { last } = await run("head -c 200000 /dev/zero | tr '\\0' x; printf END");
    expect(last.truncated).toBe(true);
    expect(last.output.endsWith("END")).toBe(true);
    expect(last.output.length).toBeLessThanOrEqual(48 * 1024);
  });

  it("fails when the working directory does not exist", async () => {
    const { rows, last } = await run("echo hi", { cwd: join(cwd, "missing") });
    expect(last).toMatchObject({ state: "failed" });
    expect(last.state === "failed" && last.message).toContain("does not exist");
    expect(rows).toHaveLength(2);
  });

  it("cancels the whole process group", async () => {
    const { rows, append } = collect();
    const handle = startShellRun({ runId: "r", command: "sleep 30 & echo $!; wait", cwd, append });
    await handle.started;
    await waitFor(() => rows.some((row) => /\d+/.test(row.output)));
    const pid = Number(rows.find((row) => /\d+/.test(row.output))!.output.trim());
    handle.cancel();
    await handle.done;
    expect(rows[rows.length - 1]).toMatchObject({ state: "killed", reason: "canceled" });
    await waitFor(() => !alive(pid));
  });

  it("kills a command that ignores SIGTERM after the grace period", async () => {
    const { last } = await runAndCancel("trap '' TERM; while :; do :; done");
    expect(last).toMatchObject({ state: "killed", reason: "canceled" });
  });

  it("kills a command that outlives the timeout", async () => {
    const { last } = await run("sleep 30", { timeoutMs: 100 });
    expect(last).toMatchObject({ state: "killed", reason: "timeout" });
  });
});

async function runAndCancel(command: string) {
  const { rows, append } = collect();
  const handle = startShellRun({ runId: "r", command, cwd, append, killGraceMs: 100 });
  await handle.started;
  await new Promise((resolve) => setTimeout(resolve, 100));
  handle.cancel();
  await handle.done;
  return { last: rows[rows.length - 1]! };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
