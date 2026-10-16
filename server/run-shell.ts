import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { ShellRun } from "../shared/shell-run";
import { createOutputBuffer } from "./output-buffer";
import { createStartGate } from "./start-gate";
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
  // Environment for the shell, and the source of $SHELL. Defaults to the daemon's.
  env?: NodeJS.ProcessEnv;
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

const NO_PROMPTS = { GIT_EDITOR: "true", GIT_TERMINAL_PROMPT: "0" };

// zsh and bash run as login, interactive shells so the user's rc files apply. With no terminal
// they print job-control and rc noise. Once the rc files have loaded, the preamble prints a
// marker line on both streams and the output before it is dropped. The rc files may set their
// own GIT_EDITOR, so the prompt guards are exported after they load.
// Extra lines per shell. A login bash prints "logout" to stderr on exit. Bash 3.2 gives each
// background job its own process group unless job control is off, which would escape cancel.
const RC_SHELL_EXTRAS: Partial<Record<string, string>> = {
  zsh: "",
  bash: 'set +m\nexit() { builtin exit "$@" 2>/dev/null; }\n',
};

function rcPreamble(shell: string, marker: string): string | undefined {
  const extra = RC_SHELL_EXTRAS[basename(shell)];
  if (extra === undefined) return undefined;
  return [
    "export GIT_EDITOR=true GIT_TERMINAL_PROMPT=0\n",
    `builtin printf '\\n%s\\n' ${marker}; builtin printf '\\n%s\\n' ${marker} >&2\n`,
    extra,
  ].join("");
}

// The runId may hold anything, and the marker is spliced into shell text.
function startMarker(runId: string): string {
  return `shell-mode-start-${runId.replace(/[^A-Za-z0-9]/g, "")}`;
}

function spawnShell(runId: string, command: string, cwd: string, env: NodeJS.ProcessEnv) {
  const shell = env.SHELL || "/bin/sh";
  const marker = startMarker(runId);
  const preamble = rcPreamble(shell, marker);
  const options = {
    cwd,
    detached: true,
    // No terminal is attached, so git must fail fast instead of waiting on an editor or a prompt.
    env: { ...env, ...NO_PROMPTS },
  } as const;
  const stdio = ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"];
  if (preamble === undefined) {
    return { child: spawn(shell, ["-c", command], { ...options, stdio }), marker: undefined };
  }
  return { child: spawn(shell, ["-lic", preamble + command], { ...options, stdio }), marker };
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

  let shell: ReturnType<typeof spawnShell>;
  try {
    shell = spawnShell(runId, command, cwd, options.env ?? process.env);
  } catch (error) {
    finish({ state: "failed", message: error instanceof Error ? error.message : String(error) });
    return { runId, started, done, cancel: () => undefined };
  }

  const { child, marker } = shell;

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
    const gate = marker === undefined ? undefined : createStartGate(marker);
    const append = (text: string) => {
      if (text) output.append(text);
    };
    stream.on("data", (chunk: Buffer) => {
      const text = decoder.write(chunk);
      append(gate ? gate.push(text) : text);
      publisher.schedule(runningRow);
    });
    stream.on("end", () => {
      const text = decoder.end();
      append(gate ? gate.push(text) + gate.end() : text);
    });
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
