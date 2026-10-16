import type { OutputSnapshot } from "./output-buffer";
import type { ShellRun } from "../shared/shell-run";
import { constants } from "node:os";

// Paseo rejects row data over 64 KiB serialized. Stay under it with room to spare.
const ROW_DATA_LIMIT_BYTES = 60 * 1024;

const SIGNAL_EXIT_CODE_BASE = 128;

export type StopReason = "canceled" | "timeout";

export interface RunMeta {
  command: string;
  cwd: string;
  startedAt: number;
}

type WithoutOutput<Row> = Row extends unknown
  ? Omit<Row, keyof RunMeta | keyof OutputSnapshot>
  : never;

export type RunStatus = WithoutOutput<ShellRun>;

export interface ProcessEnd {
  code: number | null;
  signal: NodeJS.Signals | null;
  stopReason: StopReason | null;
  durationMs: number;
}

function exitCode({ code, signal }: Pick<ProcessEnd, "code" | "signal">): number {
  if (code !== null) return code;
  return SIGNAL_EXIT_CODE_BASE + (signal ? (constants.signals[signal] ?? 0) : 0);
}

export function statusAfterExit(end: ProcessEnd): RunStatus {
  if (end.stopReason) {
    return { state: "killed", reason: end.stopReason, durationMs: end.durationMs };
  }
  return { state: "exited", exitCode: exitCode(end), durationMs: end.durationMs };
}

const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

function fitToRowLimit(row: ShellRun): ShellRun {
  if (jsonBytes(row) <= ROW_DATA_LIMIT_BYTES) return row;
  const budget = ROW_DATA_LIMIT_BYTES - jsonBytes({ ...row, output: "" }) + jsonBytes("");
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
