---
name: computer-custom
description: Use this skill to control this Windows machine - read the screen, drive apps, click, type, and inspect windows - in Claude Code or Codex, through Computer Custom's own MCP server with user-controlled policy gates.
---

# Computer Custom

Controls this Windows PC directly: screen, mouse, keyboard, windows and the
accessibility tree. It runs its own MCP server and a native helper. It does not
need any provider's bundled computer-use runtime.

## Setup

None. The plugin ships the MCP server; both providers launch it themselves.
Tools appear as `status`, `list_windows`, `ui_tree`, `click`, and so on.

If tools are missing, check that the plugin's `.mcp.json` is registered and that
`server/index.mjs` and `helper/computer-custom-helper.exe` exist inside the
installed plugin.

## The workflow that works

1. **`status`** once per session. It tells you the helper's privilege level,
   whether it has UIAccess, whether a security prompt is on screen, and how the
   helper was started. If `start.notice` is present, read it out to the user.
2. **`list_windows`** to choose a target. Note each window's `integrity`.
3. **`focus_window`** before sending any input.
4. **`ui_tree`** to see the real controls.
5. **Act.** Prefer `invoke_element` over `click` when the target came from the
   tree.
6. **Observe again** after every action.

## Read the tree, not the pixels

`ui_tree` returns real control names, values and exact bounds. `screenshot`
returns pixels you have to guess at. Prefer the tree.

- Default depth is 25, because modern apps nest deeply. A shallow read makes a
  rich window look empty.
- It returns only actionable elements by default. Pass `interactiveOnly: false`
  for everything.
- **Always check `truncated`.** If it is true, you are not seeing the whole
  window. Narrow with `depth`, or raise `maxNodes`.
- Use `screenshot` for custom-drawn UI, canvases and games, and to confirm what
  actually happened.

## Never reuse a stale look

Element ids come from the most recent `ui_tree` and expire when you read it
again. Coordinates go stale as soon as a window moves. After any action,
observe again. A `STALE_HANDLE` error means exactly this: re-read, do not retry.

## Limits that are real

These are Windows, not policy. No permission changes them.

- **`UIPI_BLOCKED`** — the target window runs at a higher privilege than the
  helper. Do not retry; nothing about the call will change the outcome. Call
  `status`: if `start.actual` is `normal`, tell the user they can install the
  elevated helper with `scripts/install-elevated-helper.ps1`. Once installed it
  is used automatically; there is no switch to set. That is their decision to
  make, not yours.
- **`SECURE_DESKTOP`** — a Windows UAC prompt is on screen and Windows is
  drawing it where nothing can reach it. **Stop.** Ask the user to answer it,
  then observe again.

Whether a consent prompt is reachable at all depends on the machine, so check
`status` rather than assuming either way:

- `uacPromptOnSecureDesktop: true` — unreachable by anything, at any privilege.
- `uacPromptOnSecureDesktop: false` **and** `uiAccess: true` — input does reach
  it. `ui_tree` still returns nothing useful, because the prompt runs at system
  integrity, so screenshot it and click by coordinates. Approving a consent
  prompt always asks the user first; never work around that.

## Shell and files

Do not type commands into a terminal window. Use `run_shell`: it runs the
command directly and hands back real output, exit code included. PowerShell by
default. Output is capped, and the result says whether it was truncated.

Use `fs_read`, `fs_write` and `fs_delete` for files. `fs_read` also lists a
directory. `fs_delete` always asks first, whatever the path, and refuses a
non-empty directory unless you pass `recursive`.

## Saved flows

`list_flows` shows what is available. `run_flow` runs one by name and returns
its log lines and result.

A flow is a JavaScript file with real loops and conditions. Every tool call
inside one passes the same gate as a direct call, so a flow can still be blocked
or stop to ask the user, and the first refused step stops the whole flow.

Pass values in with `args`; the flow reads them as `cc.args`.

## Gates

Some actions need the user's agreement first.

- Read-only tools pass without a gate.
- Input tools are classified with the **focused application** attached, so a
  rule about installers or security tools can match what is really being typed
  into.
- A gated action shows the user a prompt naming the tool and the target app.
- If the client cannot show a prompt, the call is refused with instructions.
  Relay them: ask the user for the exact phrase, then repeat the identical call
  with `confirm` set to what they said.
- **Never write a confirmation phrase yourself.** It must come from the user.
- A hard block is not a prompt. It fails, and only a policy change lifts it.

Set `COMPUTER_CUSTOM_POLICY` to use a different policy file. Both providers read
the same one.

## Accountability

`audit` shows what this session attempted, including blocked and refused
actions, with secrets redacted. Use it when the user asks what happened.

## Honesty

Never tell the user this plugin can do something Windows does not allow. If a
call fails, report the exact tool and error code.
