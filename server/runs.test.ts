import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { ShellRun } from "../shared/shell-run";
import { createShellRuns } from "./runs";
import { expectDies, printedPid, stopTracked, track } from "./test-processes";

// Paseo sends the plugin process SIGTERM 2 s after asking it to stop.
const PASEO_SHUTDOWN_DEADLINE_MS = 2000;

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "shell-mode-"));
});
afterEach(async () => {
  await stopTracked();
  rmSync(cwd, { recursive: true, force: true });
});

it("stopAll kills a command that ignores SIGTERM before Paseo's shutdown deadline", async () => {
  const rows: ShellRun[] = [];
  const runs = createShellRuns();
  const run = track(runs.start({
    runId: "r",
    command: "trap '' TERM; echo $$; while :; do :; done",
    cwd,
    env: { ...process.env, SHELL: "/bin/sh" },
    publish: async (row) => {
      rows.push(row);
    },
  }));
  await run.started;
  const pid = await printedPid(rows);
  const stopping = Date.now();
  await Promise.race([runs.stopAll(), new Promise((resolve) => setTimeout(resolve, PASEO_SHUTDOWN_DEADLINE_MS))]);
  await expectDies(pid, 100);
  expect(Date.now() - stopping).toBeLessThan(PASEO_SHUTDOWN_DEADLINE_MS);
});
