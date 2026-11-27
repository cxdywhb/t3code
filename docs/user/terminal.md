# Terminal

T3 Code includes integrated terminals running on the environment's host machine, with persistent scrollback across reconnects.

## Share terminals across conversations

Open **Global terminal** from the sidebar or command palette. Its tabs belong to the connected environment and stay available when you switch projects or conversations. The conversation's own terminal stays separate. Closing or hiding the window leaves its shells running; closing a tab ends that shell. Shells end when the host server stops.

On desktop, drag and resize the separate window and use its pin button to keep it above other applications. On web, the floating panel can be resized inside the page. The native mobile app does not provide this window.

Agents in this environment can use `global_terminal_list`, `global_terminal_open`, and `global_terminal_read`. For example, ask “Read the global terminal tab `build`.” Opening through an agent requires full access; reading is available without it. Reads return recent output with a size limit and do not continuously add terminal output to conversations. These tools can also be referenced in a skill.

In either a global or conversation terminal, right-click **Clear all** to clear only that tab's screen and retained scrollback. This does not stop its running command or clear other tabs.

## Choose a shell

Set `T3CODE_TERMINAL_SHELL` in the T3 server's environment to an executable name or full path (no quotes or arguments) to override the platform default shell for new terminals. This does not affect agent commands or project setup/settle scripts.

Example for Git Bash on Windows (PowerShell, then fully quit and reopen T3 Code):

```powershell
[Environment]::SetEnvironmentVariable('T3CODE_TERMINAL_SHELL', 'C:\Program Files\Git\bin\bash.exe', 'User')
```

> Note: Use `bin\bash.exe`, not `git-bash.exe`. Remove with `$null` to restore the default.

## Scrollback and navigation

Each terminal retains up to **5,000 lines** and **8 MiB** of scrollback on the server.

| Action                     | macOS                              | Windows / Linux                            |
| -------------------------- | ---------------------------------- | ------------------------------------------ |
| Scroll page up/down        | `Shift+PageUp` / `Shift+PageDown`  | `Shift+PageUp` / `Shift+PageDown`          |
| Jump to start / latest     | `Cmd+Shift+Home` / `Cmd+Shift+End` | `Ctrl+Shift+Home` / `Ctrl+Shift+End`       |
| Select all retained output | `Cmd+A`                            | `Ctrl+Shift+A` (`Ctrl+A` stays shell home) |
| Next / previous terminal   | `Cmd+Shift+]` / `Cmd+Shift+[`      | `Ctrl+Alt+]` / `Ctrl+Alt+[`                |

On iOS/iPadOS, long-press the terminal to paste or choose **Select Text**.

## fish shell

T3 Code launches `fish` with `no-query-term` to avoid startup delays, which overrides universal `fish_features`. To keep custom flags or re-enable `query-term`, export `fish_features` in the environment that launches T3 Code.
