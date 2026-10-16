import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ShellRun } from "../shared/shell-run";
import { startShellRun } from "./run-shell";

let cwd: string;
let home: string;
let env: NodeJS.ProcessEnv;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "shell-mode-"));
  home = mkdtempSync(join(tmpdir(), "shell-mode-home-"));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

// Points the shell's rc lookup at the temp home, so the tester's own rc files never load.
function isolatedEnv(shell: string): NodeJS.ProcessEnv {
  return { ...process.env, SHELL: shell, HOME: home, ZDOTDIR: home };
}

// Appends take a random moment, as a real round trip to the daemon would.
function collect() {
  const rows: ShellRun[] = [];
  const append = async (row: ShellRun) => {
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 20));
    rows.push(row);
  };
  return { rows, append };
}

async function run(command: string, options: Partial<Parameters<typeof startShellRun>[0]> = {}) {
  const { rows, append } = collect();
  const handle = startShellRun({ runId: "run-1", command, cwd, append, env, ...options });
  await handle.started;
  await handle.done;
  return { rows, last: rows[rows.length - 1]!, handle };
}

// macOS ships bash 3.2 as /bin/bash, and users often add a newer one with Homebrew. Both must work.
const BASHES = (
  process.platform === "darwin"
    ? ["/bin/bash", "/opt/homebrew/bin/bash", "/usr/local/bin/bash"]
    : ["/bin/bash", "/usr/bin/bash"]
).filter(
  (path, index, all) =>
    existsSync(path) && all.findIndex((p) => existsSync(p) && realpathSync(p) === realpathSync(path)) === index,
);

const SHELLS = [
  { name: "sh (-c)", shell: "/bin/sh" },
  { name: "zsh (login, interactive)", shell: "/bin/zsh" },
  ...BASHES.map((shell) => ({ name: `bash (login, interactive) ${shell}`, shell })),
].filter((entry) => existsSync(entry.shell));

describe.each(SHELLS)("startShellRun with $name", ({ shell }) => {
  beforeEach(() => {
    env = isolatedEnv(shell);
  });

  it("runs a command, interleaves stdout and stderr, and ends with the exit code", async () => {
    const { rows, last } = await run("printf a; sleep 0.1; printf b >&2; exit 3");
    expect(rows[0]).toMatchObject({ state: "running", runId: "run-1", output: "" });
    expect(rows.slice(0, -1).every((row) => row.state === "running")).toBe(true);
    expect(last).toMatchObject({ state: "exited", exitCode: 3, output: "ab", truncated: false, cwd });
  });

  it("runs in the given directory with git prompts disabled", async () => {
    const { last } = await run('pwd; echo "$GIT_EDITOR $GIT_TERMINAL_PROMPT"');
    expect(last).toMatchObject({ state: "exited", exitCode: 0 });
    expect(last.output).toContain("shell-mode-");
    expect(last.output).toContain("true 0");
  });

  it("keeps only the tail of large output", async () => {
    const { last } = await run("head -c 200000 /dev/zero | tr '\\0' x; printf END");
    expect(last.truncated).toBe(true);
    expect(last.output.endsWith("END")).toBe(true);
    expect(last.output.length).toBeLessThanOrEqual(48 * 1024);
  });

  it("fails when the working directory does not exist", async () => {
    const { rows, last } = await run("echo hi", { cwd: join(cwd, "missing") });
    expect(last).toMatchObject({ state: "failed" });
    expect(last.state === "failed" && last.message).toContain("does not exist");
    expect(rows).toHaveLength(2);
  });

  it("cancels the whole process group", async () => {
    const { rows, append } = collect();
    const handle = startShellRun({ runId: "r", command: "sleep 30 & echo $!; wait", cwd, append, env });
    await handle.started;
    const pidLine = /^\d+$/m;
    await waitFor(() => rows.some((row) => pidLine.test(row.output)));
    const pid = Number(pidLine.exec(rows.find((row) => pidLine.test(row.output))!.output)![0]);
    expect(alive(pid)).toBe(true);
    handle.cancel();
    await handle.done;
    expect(rows[rows.length - 1]).toMatchObject({ state: "killed", reason: "canceled" });
    await waitFor(() => !alive(pid));
  });

  it("kills a command that ignores SIGTERM after the grace period", async () => {
    const { last } = await runAndCancel("trap '' TERM; while :; do :; done");
    expect(last).toMatchObject({ state: "killed", reason: "canceled" });
  });

  it("kills a command that outlives the timeout", async () => {
    const { last } = await run("sleep 30", { timeoutMs: 100 });
    expect(last).toMatchObject({ state: "killed", reason: "timeout" });
  });
});

const RC_SHELLS = [
  { name: "zsh", shell: "/bin/zsh", rcFile: ".zshrc" },
  ...BASHES.map((shell) => ({ name: `bash ${shell}`, shell, rcFile: ".bash_profile" })),
].filter((entry) => existsSync(entry.shell));

describe.each(RC_SHELLS)("$name rc files", ({ shell, rcFile }) => {
  beforeEach(() => {
    env = isolatedEnv(shell);
  });

  it("applies the rc file, hides its startup output, and keeps the git prompt guards", async () => {
    const rc = [
      "alias hi='echo aliased'",
      "echo rc-stdout-noise",
      "echo rc-stderr-noise >&2",
      "export GIT_EDITOR=vim",
    ];
    writeFileSync(join(home, rcFile), rc.join("\n"));
    const { last } = await run('hi; echo "editor=$GIT_EDITOR"');
    expect(last).toMatchObject({ state: "exited", exitCode: 0 });
    expect(last.output).toBe("aliased\neditor=true\n");
  });

  it("hides rc output that has no trailing newline", async () => {
    writeFileSync(join(home, rcFile), "printf rc-stdout; printf rc-stderr >&2");
    const { last } = await run("printf out");
    expect(last).toMatchObject({ state: "exited", exitCode: 0, output: "out" });
  });

  it("shows the rc file's output when it exits before the command runs", async () => {
    writeFileSync(join(home, rcFile), "echo rc-stdout\necho rc-stderr >&2\nexit 3");
    const { last } = await run("echo never");
    expect(last).toMatchObject({ state: "exited", exitCode: 3 });
    expect(last.output).toContain("rc-stdout");
    expect(last.output).toContain("rc-stderr");
    expect(last.output).not.toContain("never");
  });
});

describe.each(BASHES)("bash %s profile", (shell) => {
  it("loads .bashrc when .bash_profile sources it", async () => {
    writeFileSync(join(home, ".bash_profile"), '[ -f ~/.bashrc ] && . ~/.bashrc\n');
    writeFileSync(join(home, ".bashrc"), "alias hi='echo from-bashrc'\necho bashrc-noise\n");
    env = isolatedEnv(shell);
    const { last } = await run("hi");
    expect(last).toMatchObject({ state: "exited", exitCode: 0, output: "from-bashrc\n" });
  });
});

describe("shells without rc support", () => {
  it("runs with -c and does not read rc files", async () => {
    writeFileSync(join(home, ".profile"), "echo profile-noise\n");
    env = isolatedEnv("/bin/sh");
    const { last } = await run("echo ok");
    expect(last.output).toBe("ok\n");
  });
});

async function runAndCancel(command: string) {
  const { rows, append } = collect();
  const handle = startShellRun({ runId: "r", command, cwd, append, env, killGraceMs: 100 });
  await handle.started;
  await new Promise((resolve) => setTimeout(resolve, 100));
  handle.cancel();
  await handle.done;
  return { last: rows[rows.length - 1]! };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
