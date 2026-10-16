import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const SHELL_RUN_KIND = "shell-run";
export const SHELL_RUN_VERSION = 1;

export const OUTPUT_TAIL_BYTES = 48 * 1024;

const common = {
  command: z.string(),
  cwd: z.string(),
  output: z.string(),
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
