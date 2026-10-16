import type { PluginHandlerContext } from "@getpaseo/plugin/server";

export async function agentDirectory(
  { paseo }: PluginHandlerContext,
  agentId: string,
): Promise<string> {
  const snapshot = await paseo.agents.ref(agentId).refresh();
  if (!snapshot?.agent.cwd) throw new Error("Agent has no working directory");
  return snapshot.agent.cwd;
}
