import { startShellRun, type ShellRunHandle, type ShellRunOptions } from "./run-shell";

export interface ShellRuns {
  start(options: ShellRunOptions): ShellRunHandle;
  // A run that already finished is not an error: the user may press Stop as it ends.
  cancel(runId: string): void;
  // Stops every live run and waits for each to write its final row.
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
