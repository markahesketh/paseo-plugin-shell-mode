import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { Readable } from "node:stream";
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
// they print job-control and rc noise on stderr. The command's own output is moved to fds 3 and 4
// after the rc files have loaded, so only the command's output is read. The rc files may also
// set their own GIT_EDITOR, so the prompt guards are exported after they load.
const RC_PREAMBLE = "exec 1>&3 2>&4 3>&- 4>&-\nexport GIT_EDITOR=true GIT_TERMINAL_PROMPT=0\n";
// A login bash prints "logout" to stderr on exit.
const BASH_PREAMBLE = `${RC_PREAMBLE}exit() { builtin exit "$@" 2>/dev/null; }\n`;
const RC_PREAMBLES: Partial<Record<string, string>> = {
  zsh: RC_PREAMBLE,
  bash: BASH_PREAMBLE,
};

function spawnShell(command: string, cwd: string, env: NodeJS.ProcessEnv) {
  const shell = env.SHELL || "/bin/sh";
  const preamble = RC_PREAMBLES[basename(shell)];
  const options = {
    cwd,
    detached: true,
    // No terminal is attached, so git must fail fast instead of waiting on an editor or a prompt.
    env: { ...env, ...NO_PROMPTS },
  } as const;
  if (preamble === undefined) {
    const child = spawn(shell, ["-c", command], {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { child, outputs: [child.stdout, child.stderr] };
  }
  const child = spawn(shell, ["-lic", preamble + command], {
    ...options,
    stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
  });
  // Both descriptors were opened as pipes just above.
  return {
    child,
    outputs: [child.stdio[3] as Readable, child.stdio[4] as Readable],
  };
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
    shell = spawnShell(command, cwd, options.env ?? process.env);
  } catch (error) {
    finish({ state: "failed", message: error instanceof Error ? error.message : String(error) });
    return { runId, started, done, cancel: () => undefined };
  }

  const { child, outputs } = shell;

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

  for (const stream of outputs) {
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
