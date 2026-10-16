import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useState } from "react";
import { Pressable, Text } from "react-native";
import { shellCancelRpc } from "../shared/shell-run";

export function StopButton({
  runId,
  theme,
  compact,
}: {
  runId: string;
  theme: PluginTheme;
  compact: boolean;
}) {
  const cancel = useRpc(shellCancelRpc);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");

  function stop() {
    setStopping(true);
    setError("");
    cancel({ runId }).catch((failure: unknown) => {
      setStopping(false);
      setError(failure instanceof Error ? failure.message : String(failure));
    });
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Stop command"
      accessibilityHint={error || undefined}
      disabled={stopping}
      hitSlop={8}
      onPress={stop}
      style={({ pressed }) => ({
        borderWidth: 1,
        borderColor: theme.colors.statusDanger,
        borderRadius: 6,
        paddingHorizontal: compact ? 8 : 10,
        paddingVertical: 3,
        opacity: pressed || stopping ? 0.6 : 1,
      })}
    >
      <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>
        {stopping ? "Stopping" : error ? "Stop failed, retry" : "Stop"}
      </Text>
    </Pressable>
  );
}
