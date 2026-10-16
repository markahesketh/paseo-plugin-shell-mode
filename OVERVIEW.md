Shell mode adds a `/sh` command to the message composer. Type `/sh git status` in an agent's chat and the command runs in a shell in that agent's working directory. The output appears as a row in the chat and streams while the command runs. A Stop button cancels a running command.

Nothing is sent to the agent. The command and its output are not part of the agent's context, so the agent will not see them unless you paste them into a message.

It suits one-shot commands such as git, builds, and test runs. It is not a terminal.

## How it runs

The daemon starts your shell (`$SHELL`, or `/bin/sh`) in the agent's working directory. For zsh and bash it is a login, interactive shell, so the aliases, functions, and `PATH` changes from your rc files apply. Startup output from those files is hidden, and each run pays their load time (roughly 100 to 150 ms with a typical zsh setup). Any other shell, such as fish or sh, runs the command with `-c` and does not load rc files.

Standard output and standard error are shown together in the order they arrive, with terminal color codes removed.

## Limits

- Commands have no input and no terminal. Anything that waits for a keypress, a password, or a prompt will hang until you stop it or it times out.
- `GIT_EDITOR` is set to `true` and `GIT_TERMINAL_PROMPT` to `0`, after your rc files load, so `git commit` without `-m` fails with git's own message instead of waiting for an editor.
- A command is stopped after 10 minutes. Stopping, by timeout or by pressing Stop, signals the whole process group, then force-kills it after a few seconds.
- A command that leaves a background process holding its output open keeps the row running until that process ends or the timeout is reached.
- The row keeps the last 48 KB of output and says so when earlier output was dropped.
- Rows are kept in the daemon's memory like other timeline rows, so they do not survive a daemon restart. A command still running when the plugin is reloaded, disabled, or removed is stopped.
- macOS's built-in `/bin/bash` (3.2) cannot run the interactive login mode with output capture, so a run under it shows no output. Use zsh or a newer bash.
- Works on macOS and Linux daemons. Requires Paseo 0.11.4 or later.
