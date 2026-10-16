import type { ShellRun } from "../shared/shell-run";

export type Tone = "success" | "danger" | "warning" | "muted";

export interface StatusLabel {
  text: string;
  tone: Tone;
}

export function describeStatus(run: ShellRun): StatusLabel {
  switch (run.state) {
    case "running":
      return { text: "running", tone: "muted" };
    case "exited":
      return { text: `exit ${run.exitCode}`, tone: run.exitCode === 0 ? "success" : "danger" };
    case "killed":
      return { text: run.reason === "timeout" ? "timed out" : "canceled", tone: "warning" };
    case "failed":
      return { text: run.message, tone: "danger" };
  }
}

export function durationOf(run: ShellRun): number | null {
  return run.state === "exited" || run.state === "killed" ? run.durationMs : null;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  if (minutes < 60) return `${minutes}m ${String(rest).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
