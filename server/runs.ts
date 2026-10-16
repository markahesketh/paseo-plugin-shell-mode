import { startShellRun, type ShellRunHandle, type ShellRunOptions } from "./run-shell";

export interface ShellRuns {
  start(options: ShellRunOptions): ShellRunHandle;
  cancel(runId: string): void;
  stopAll(): Promise<void>;
}

export function createShellRuns(): ShellRuns {
  const live = new Map<string, ShellRunHandle>();
  return {
    start(options) {
      const run = startShellRun(options);
      live.set(run.runId, run);
      void run.done.then(() => live.delete(run.runId));
      return run;
    },
    cancel: (runId) => live.get(runId)?.cancel(),
    async stopAll() {
      const runs = [...live.values()];
      for (const run of runs) run.cancel();
      await Promise.all(runs.map((run) => run.done));
    },
  };
}
