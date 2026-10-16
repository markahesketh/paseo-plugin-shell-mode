import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const SHELL_RUN_KIND = "shell-run";
export const SHELL_RUN_VERSION = 1;

// Paseo rejects timeline row data over 64 KiB, so the output tail stays well under it.
export const OUTPUT_TAIL_BYTES = 48 * 1024;

const common = {
  command: z.string(),
  cwd: z.string(),
  // stdout and stderr interleaved in arrival order, ANSI escapes stripped.
  output: z.string(),
  // True when the head of the output was dropped to stay within the tail cap.
  truncated: z.boolean(),
  startedAt: z.number(),
};

export const shellRunSchema = z.discriminatedUnion("state", [
  z.object({ ...common, state: z.literal("running"), runId: z.string() }),
  z.object({
    ...common,
    state: z.literal("exited"),
    exitCode: z.number(),
    durationMs: z.number(),
  }),
  z.object({
    ...common,
    state: z.literal("killed"),
    reason: z.enum(["canceled", "timeout"]),
    durationMs: z.number(),
  }),
  // The shell could not start, for example a missing working directory.
  z.object({ ...common, state: z.literal("failed"), message: z.string() }),
]);

export type ShellRun = z.output<typeof shellRunSchema>;

export const shellRunRpc = defineRpc({
  name: "shell.run",
  input: z.object({ agentId: z.string(), command: z.string() }),
  output: z.object({ runId: z.string() }),
});

export const shellCancelRpc = defineRpc({
  name: "shell.cancel",
  input: z.object({ runId: z.string() }),
  output: z.object({}),
});
