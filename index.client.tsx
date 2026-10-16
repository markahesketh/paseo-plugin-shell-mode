import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ShellRunRow } from "./client/shell-run-row";
import {
  SHELL_RUN_KIND,
  SHELL_RUN_VERSION,
  shellRunRpc,
  shellRunSchema,
} from "./shared/shell-run";

export default function contribute(client: PluginClientContext) {
  client.addSlashCommand({
    name: "sh",
    description: "Run a shell command in this agent's directory",
    argumentHint: "<command>",
    context: "agent",
    async onSubmit({ args, agent, rpc }) {
      if (!args) throw new Error("Add a command after /sh, for example /sh git status");
      await rpc(shellRunRpc, { agentId: agent.id, command: args });
    },
  });
  client.addTimelineRenderer({
    kind: SHELL_RUN_KIND,
    version: SHELL_RUN_VERSION,
    schema: shellRunSchema,
    Component: ShellRunRow,
  });
  return () => {};
}
