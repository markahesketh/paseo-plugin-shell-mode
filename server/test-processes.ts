import type { ShellRun } from "../shared/shell-run";
import type { ShellRunHandle } from "./run-shell";

const tracked: ShellRunHandle[] = [];

export function track(handle: ShellRunHandle): ShellRunHandle {
  tracked.push(handle);
  return handle;
}

export async function stopTracked(): Promise<void> {
  const handles = tracked.splice(0);
  for (const handle of handles) handle.cancel();
  await Promise.all(handles.map((handle) => handle.done));
}

export async function printedPid(rows: ShellRun[]): Promise<number> {
  const pidLine = /^\d+$/m;
  await waitFor(() => rows.some((row) => pidLine.test(row.output)));
  return Number(pidLine.exec(rows.find((row) => pidLine.test(row.output))!.output)![0]);
}

export async function expectDies(pid: number, timeoutMs?: number): Promise<void> {
  try {
    await waitFor(() => !alive(pid), timeoutMs);
  } finally {
    if (alive(pid)) process.kill(pid, "SIGKILL");
  }
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
