import { randomUUID } from "node:crypto";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { agentDirectory } from "./server/agent";
import { createShellRuns } from "./server/runs";
import {
  SHELL_RUN_KIND,
  SHELL_RUN_VERSION,
  shellCancelRpc,
  shellRunRpc,
} from "./shared/shell-run";

export default function contribute(server: PluginServerContext) {
  const runs = createShellRuns();

  server.handle(shellRunRpc, async ({ agentId, command }, context) => {
    const cwd = await agentDirectory(context, agentId);
    const timeline = context.paseo.agents.ref(agentId).timeline;
    const runId = randomUUID();
    const run = runs.start({
      runId,
      command,
      cwd,
      append: (data) =>
        timeline.append({
          type: "plugin",
          id: runId,
          kind: SHELL_RUN_KIND,
          version: SHELL_RUN_VERSION,
          data,
        }),
    });
    try {
      await run.started;
    } catch (error) {
      // Without the first row the user would see nothing, so surface the failure instead.
      run.cancel();
      throw error;
    }
    return { runId };
  });

  server.handle(shellCancelRpc, ({ runId }) => {
    runs.cancel(runId);
    return {};
  });

  return () => runs.stopAll();
}
