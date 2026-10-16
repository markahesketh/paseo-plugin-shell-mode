import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import type { ShellRun } from "../shared/shell-run";
import { createOutputBuffer } from "./output-buffer";
import { buildRow, statusAfterExit, type RunStatus, type StopReason } from "./row";
import { createThrottledPublisher } from "./throttled-publisher";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_KILL_GRACE_MS = 3000;
const DEFAULT_THROTTLE_MS = 250;

export interface ShellRunOptions {
  runId: string;
  command: string;
  cwd: string;
  // Writes the row to the agent timeline. Called with the same run id for every update.
  append(row: ShellRun): Promise<unknown>;
  onError?(error: unknown): void;
  timeoutMs?: number;
  killGraceMs?: number;
  throttleMs?: number;
}

export interface ShellRunHandle {
  runId: string;
  // Resolves once the first row is appended. Rejects if it could not be.
  started: Promise<void>;
  // Resolves once the final row is appended. Never rejects.
  done: Promise<void>;
  cancel(): void;
}

function describeSpawnError(error: Error, cwd: string): string {
  const code = (error as NodeJS.ErrnoException).code;
  // Node reports a missing working directory as ENOENT for the shell.
  if (code === "ENOENT" && !existsSync(cwd)) return `Working directory does not exist: ${cwd}`;
  return error.message;
}

function spawnShell(command: string, cwd: string) {
  return spawn(process.env.SHELL || "/bin/sh", ["-c", command], {
    cwd,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    // No terminal is attached, so git must fail fast instead of waiting on an editor or a prompt.
    env: { ...process.env, GIT_EDITOR: "true", GIT_TERMINAL_PROMPT: "0" },
  });
}

export function startShellRun(options: ShellRunOptions): ShellRunHandle {
  const { runId, command, cwd } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const onError = options.onError ?? ((error) => console.error("Shell run update failed", error));

  const meta = { command, cwd, startedAt: Date.now() };
  const output = createOutputBuffer();
  const publisher = createThrottledPublisher(
    options.append,
    options.throttleMs ?? DEFAULT_THROTTLE_MS,
    onError,
  );
  const row = (status: RunStatus) => buildRow(meta, output.snapshot(), status);
  const runningRow = () => row({ state: "running", runId });

  let stopReason: StopReason | null = null;
  let finished = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  function finish(status: RunStatus): void {
    if (finished) return;
    finished = true;
    clearTimeout(killTimer);
    clearTimeout(timeoutTimer);
    void publisher.finish(row(status)).then(resolveDone);
  }

  const started = publisher.now(runningRow());
  started.catch(() => undefined);

  let child: ReturnType<typeof spawnShell>;
  try {
    child = spawnShell(command, cwd);
  } catch (error) {
    finish({ state: "failed", message: error instanceof Error ? error.message : String(error) });
    return { runId, started, done, cancel: () => undefined };
  }

  // The shell leads its own process group, so one signal reaches everything it started.
  function signalGroup(signal: NodeJS.Signals): void {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, signal);
    } catch {
      // The group is already gone.
    }
  }

  function stop(reason: StopReason): void {
    if (finished || stopReason) return;
    stopReason = reason;
    signalGroup("SIGTERM");
    killTimer = setTimeout(() => signalGroup("SIGKILL"), killGraceMs);
  }

  for (const stream of [child.stdout, child.stderr]) {
    const decoder = new StringDecoder("utf8");
    stream.on("data", (chunk: Buffer) => {
      output.append(decoder.write(chunk));
      publisher.schedule(runningRow);
    });
    stream.on("end", () => output.append(decoder.end()));
  }

  child.on("error", (error) => {
    if (child.pid === undefined) {
      finish({ state: "failed", message: describeSpawnError(error, cwd) });
    } else {
      onError(error);
    }
  });
  child.on("close", (code, signal) =>
    finish(
      statusAfterExit({ code, signal, stopReason, durationMs: Date.now() - meta.startedAt }),
    ),
  );

  timeoutTimer = setTimeout(() => stop("timeout"), timeoutMs);

  return { runId, started, done, cancel: () => stop("canceled") };
}
