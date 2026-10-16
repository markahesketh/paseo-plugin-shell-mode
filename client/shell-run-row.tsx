import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { useMemo, useRef } from "react";
import { ActivityIndicator, Platform, ScrollView, Text, View } from "react-native";
import { OUTPUT_TAIL_BYTES, type ShellRun } from "../shared/shell-run";
import { StopButton } from "./stop-button";
import { describeStatus, durationOf, formatDuration, type Tone } from "./status";

const MONOSPACE = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
});

function toneColor(theme: PluginTheme, tone: Tone): string {
  switch (tone) {
    case "success":
      return theme.colors.statusSuccess;
    case "danger":
      return theme.colors.statusDanger;
    case "warning":
      return theme.colors.statusWarning;
    case "muted":
      return theme.colors.foregroundMuted;
  }
}

function createStyles(theme: PluginTheme, compact: boolean) {
  return {
    card: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 8,
      backgroundColor: theme.colors.surface1,
      padding: compact ? 8 : 12,
      gap: compact ? 6 : 8,
    },
    header: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: 8 },
    command: {
      flex: 1,
      color: theme.colors.foreground,
      fontFamily: MONOSPACE,
      fontSize: compact ? 13 : 14,
    },
    statusRow: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      alignItems: "center" as const,
      columnGap: 6,
    },
    meta: { color: theme.colors.foregroundMuted, fontSize: 12 },
    cwd: { flexShrink: 1, color: theme.colors.foregroundMuted, fontSize: 12 },
    note: { color: theme.colors.foregroundMuted, fontSize: 12 },
    outputBox: {
      maxHeight: compact ? 200 : 320,
      borderRadius: 6,
      backgroundColor: theme.colors.surface0,
    },
    output: {
      padding: compact ? 8 : 10,
      color: theme.colors.foreground,
      fontFamily: MONOSPACE,
      fontSize: 12,
      lineHeight: 17,
    },
  };
}

export function ShellRunRow({ item, theme, layout }: PluginTimelineItemProps<ShellRun>) {
  const run = item.data;
  const styles = useMemo(() => createStyles(theme, layout.compact), [theme, layout.compact]);
  const scroll = useRef<ScrollView>(null);
  const status = describeStatus(run);
  const duration = durationOf(run);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text selectable numberOfLines={4} style={styles.command}>
          {`$ ${run.command}`}
        </Text>
        {run.state === "running" ? (
          <StopButton runId={run.runId} theme={theme} compact={layout.compact} />
        ) : null}
      </View>
      <View style={styles.statusRow}>
        {run.state === "running" ? (
          <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
        ) : null}
        <Text style={[styles.meta, { color: toneColor(theme, status.tone) }]}>{status.text}</Text>
        {duration !== null ? <Text style={styles.meta}>{formatDuration(duration)}</Text> : null}
        <Text numberOfLines={1} ellipsizeMode="head" style={styles.cwd}>
          {run.cwd}
        </Text>
      </View>
      {run.truncated ? (
        <Text style={styles.note}>{`Showing last ${OUTPUT_TAIL_BYTES / 1024} KB of output`}</Text>
      ) : null}
      {run.output ? (
        <ScrollView
          ref={scroll}
          nestedScrollEnabled
          style={styles.outputBox}
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
        >
          <Text selectable style={styles.output}>
            {run.output}
          </Text>
        </ScrollView>
      ) : null}
    </View>
  );
}
