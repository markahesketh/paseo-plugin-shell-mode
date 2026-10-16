import type { OutputSnapshot } from "./output-buffer";
import type { ShellRun } from "../shared/shell-run";
import { constants } from "node:os";

// Paseo rejects row data over 64 KiB serialized. Stay under it with room to spare.
const ROW_DATA_LIMIT_BYTES = 60 * 1024;

export type StopReason = "canceled" | "timeout";

export interface RunMeta {
  command: string;
  cwd: string;
  startedAt: number;
}

type WithoutOutput<Row> = Row extends unknown
  ? Omit<Row, keyof RunMeta | keyof OutputSnapshot>
  : never;

// The part of a row that differs between states.
export type RunStatus = WithoutOutput<ShellRun>;

export interface ProcessEnd {
  code: number | null;
  signal: NodeJS.Signals | null;
  stopReason: StopReason | null;
  durationMs: number;
}

// A process that died to a signal nobody asked for reports the shell convention, 128 + signal.
function exitCode({ code, signal }: Pick<ProcessEnd, "code" | "signal">): number {
  if (code !== null) return code;
  return 128 + (signal ? (constants.signals[signal] ?? 0) : 0);
}

export function statusAfterExit(end: ProcessEnd): RunStatus {
  if (end.stopReason) {
    return { state: "killed", reason: end.stopReason, durationMs: end.durationMs };
  }
  return { state: "exited", exitCode: exitCode(end), durationMs: end.durationMs };
}

const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

// A control character serializes as a 6 byte \u escape, so the tail cap alone does not bound the
// row. When the row is still too big, drop the head of the output until it fits.
function fitToRowLimit(row: ShellRun): ShellRun {
  if (jsonBytes(row) <= ROW_DATA_LIMIT_BYTES) return row;
  // The empty string in the base row already accounts for the quotes around the output.
  const budget = ROW_DATA_LIMIT_BYTES - jsonBytes({ ...row, output: "" }) + 2;
  let low = 0;
  let high = row.output.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (jsonBytes(row.output.slice(middle)) <= budget) high = middle;
    else low = middle + 1;
  }
  const next = row.output.charCodeAt(low);
  if (next >= 0xdc00 && next <= 0xdfff) low++;
  return { ...row, output: row.output.slice(low), truncated: true };
}

export function buildRow(meta: RunMeta, output: OutputSnapshot, status: RunStatus): ShellRun {
  return fitToRowLimit({ ...meta, ...output, ...status });
}
