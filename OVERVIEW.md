Shell mode adds a `/sh` command to the message composer. Type `/sh git status` in an agent's chat and the command runs in a shell in that agent's working directory. The output appears as a row in the chat and streams while the command runs. A Stop button cancels a running command.

Nothing is sent to the agent. The command and its output are not part of the agent's context, so the agent will not see them unless you paste them into a message.

It suits one-shot commands such as git, builds, and test runs. It is not a terminal.

## How it runs

The daemon starts your shell (`$SHELL`, or `/bin/sh`) with `-c` and the command, in the agent's working directory. The shell is not a login or interactive shell, so it only sees the environment the daemon was started with. Standard output and standard error are shown together in the order they arrive, with terminal color codes removed.

## Limits

- Commands have no input and no terminal. Anything that waits for a keypress, a password, or a prompt will hang until you stop it or it times out.
- `GIT_EDITOR` is set to `true` and `GIT_TERMINAL_PROMPT` to `0`, so `git commit` without `-m` fails with git's own message instead of waiting for an editor.
- A command is stopped after 10 minutes. Stopping, by timeout or by pressing Stop, signals the whole process group, then force-kills it after a few seconds.
- A command that leaves a background process holding its output open keeps the row running until that process ends or the timeout is reached.
- The row keeps the last 48 KB of output and says so when earlier output was dropped.
- Rows are kept in the daemon's memory like other timeline rows, so they do not survive a daemon restart. A command still running when the plugin is reloaded, disabled, or removed is stopped.
- Works on macOS and Linux daemons. Requires Paseo 0.11.4 or later.
