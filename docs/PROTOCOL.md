# Server ↔ Helper Protocol

_Phase 0 contract. 2026-09-19._

Two parts talk to each other. This file says how. Get this right and the rest is
just filling in.

- **Server** — Node/TypeScript. Started by Claude Code or Codex. Runs at
  **normal** power. Holds the tools, the policy, the audit log.
- **Helper** — C#. A small `.exe`. Does the real input, screen and UI work. Can
  run at **normal** or **high** power.

They talk over a **local named pipe**. Nothing touches the network. Ever.

---

## 1. Why a separate helper at all

Three reasons:

1. **Power.** The server must stay at normal power, because Claude/Codex start
   it and we do not want your whole client elevated. The helper can be raised to
   high power on its own.
2. **Signing.** A `uiAccess` app must be our own signed `.exe`. That has to be
   the thing sending the input.
3. **Swap.** The pipe is a seam. The helper's insides can be rewritten without
   touching tools or policy.

---

## 2. Transport

- Named pipe: `\\.\pipe\computer-custom.<session-id>`
- **The helper creates the pipe. The server connects to it.**
- Frame: 4-byte little-endian length, then that many bytes of UTF-8 JSON.
- One request → one response. Requests carry an `id`; responses echo it.
- Screenshots return raw PNG bytes in a second frame, not base64 inside JSON.
  Base64 in JSON would be about a third bigger and slower.

### Pipe security

Threat: another program running **as you** tries to drive your mouse and
keyboard through our pipe. Same-user is the hard case — Windows already keeps
other accounts out, but it does not separate two programs of your own.

Three things together close it:

1. **The helper owns the pipe.** C# `NamedPipeServerStream` accepts a
   `PipeSecurity`, so the helper builds an ACL granting **only the current
   user's SID**. Node's `net` module cannot set a pipe ACL, so if the server
   owned the pipe we would be stuck with the default one. This is why the
   direction is what it is.
2. **The token travels privately.** The server generates 32 random bytes and
   writes them to the helper's **stdin**. Not the command line — command lines
   are readable by other processes on the machine. Not an environment variable,
   for the same reason.
3. **The helper proves first.** On connect, the **helper** sends the token and
   the **server** verifies it, before the server sends anything.

Point 3 is the one that matters and it is easy to get backwards. If the server
spoke first, a program that squatted the pipe name ahead of the real helper
would simply be handed the token. Because only the real helper ever received the
token on stdin, making the helper prove first means a squatter has nothing to
say and the server drops the connection.

Token comparison is length-checked, then `timingSafeEqual`.

---

## 3. Helper startup modes

| Mode | How it starts | Token arrives by | Power | Reaches |
| --- | --- | --- | --- | --- |
| `normal` | Server spawns it directly | stdin | Medium | Normal app windows |
| `elevated` | Server ShellExecutes the signed helper | session file | High + UIAccess | Normal **and** elevated app windows |

### Why the token travels differently

A normal start hands the token over **stdin**, the most private channel there
is: another process running as you cannot read another process's stdin.

An elevated start goes through **ShellExecute**, which cannot redirect stdin,
so per-run values have to be left somewhere both sides agree on. The server
writes `%LOCALAPPDATA%\computer-custom\session.json`, and the helper deletes it
the moment it has been read — including when the read fails.

This is weaker than stdin: for a few milliseconds the token exists in a file,
readable by anything already running as you. That is the cost of elevated mode,
and the reason the session file is written on the elevated path only. Elevated
mode is the default (opt out with `COMPUTER_CUSTOM_ELEVATED=0`), so this
trade-off applies whenever the signed helper is installed.

### Why ShellExecute, and not anything else

A `uiAccess` binary **cannot be started by CreateProcess**. Only the AppInfo
service can issue a UIAccess token, and CreateProcess never asks it. Measured on
this machine:

| Launch path | Result |
| --- | --- |
| Node `spawn` (CreateProcess) | `EACCES` |
| Scheduled task (CreateProcess) | `ERROR_ELEVATION_REQUIRED` (740) |
| PowerShell `Start-Process` (ShellExecute) | works: high integrity, uiAccess true |

`Start-Process` must carry no redirection and no `-NoNewWindow`; either forces
UseShellExecute off and puts you back on the broken path. No UAC prompt appears:
granting UIAccess to a signed binary in a protected folder is exactly what the
mechanism exists for.

The helper is built as `WinExe` for the same reason. ShellExecute cannot hide a
console the way CreateProcess can, so a console-subsystem helper would flash a
black window on every elevated launch.


The server picks the mode per session, not per call. Switching modes means
restarting the helper. The server tells the agent which mode is live, so the
agent knows what it can reach.

If `elevated` is asked for but the signed helper is not installed, the helper
starts in `normal` and `status` reports both what was asked for and what was
obtained, with a notice saying how to fix it. It does not fail silently, and it
never tries to elevate on its own — that would mean a UAC prompt nobody asked
for.

---

## 4. Request shape

```json
{ "id": 17, "op": "click", "args": { "x": 840, "y": 512, "button": "left" } }
```

Response, success:

```json
{ "id": 17, "ok": true, "result": { "x": 840, "y": 512 } }
```

Response, failure:

```json
{ "id": 17, "ok": false, "error": { "code": "UIPI_BLOCKED", "message": "..." } }
```

### Error codes

| Code | Means | What the agent should do |
| --- | --- | --- |
| `UIPI_BLOCKED` | Target window is at higher power than the helper | Ask to restart the helper elevated |
| `SECURE_DESKTOP` | The secure desktop is up (a UAC box is showing) | Stop. Ask the user to click it |
| `NO_TARGET` | Window or element is gone | Re-observe, do not retry blind |
| `STALE_HANDLE` | Screenshot/element id is too old | Re-observe |
| `BAD_ARGS` | Bad input | Fix the call |

`SECURE_DESKTOP` matters. The helper detects it by checking the input desktop
name. When it is up, we stop cleanly and say so, instead of clicking into
nothing. This is the honest behaviour for level 3.

---

## 5. Operations the helper must provide

### Look (level 0)

| Op | Args | Returns |
| --- | --- | --- |
| `screenshot` | `display?`, `region?` | PNG bytes + size + a `frame_id` |
| `list_windows` | — | title, process, pid, rect, power level, visible |
| `focus_window` | `handle` | ok |
| `ui_tree` | `handle`, `depth?` | element tree: role, name, value, rect, `element_id` |

`ui_tree` uses Windows UI Automation. It is better than pixels: you get real
button names. Use it first, fall back to screenshot + coordinates.

### Act (level 1 and 2)

| Op | Args |
| --- | --- |
| `move` | `x`, `y` |
| `click` | `x`, `y`, `button`, `count?` |
| `drag` | `from`, `to`, `button` |
| `scroll` | `x`, `y`, `dx`, `dy` |
| `type_text` | `text` |
| `key` | `keys` (e.g. `["ctrl","s"]`) |
| `clipboard_get` / `clipboard_set` | `text?` |
| `invoke_element` | `element_id` |

All input uses `SendInput` with absolute coordinates. Not `SetCursorPos` — some
apps and games ignore that one.

`invoke_element` clicks through UI Automation instead of pixels. More reliable
when it works. The agent should prefer it.

### Health

| Op | Returns |
| --- | --- |
| `ping` | helper version, power level, uiAccess yes/no, display list |

The server calls `ping` on connect and shows the result to the agent. The agent
then knows exactly what it can and cannot reach, before it tries.

---

## 6. What stays in the server (not the helper)

The helper is **dumb on purpose**. It does not decide anything.

- Policy (allow / confirm / block) — server.
- Confirmation prompts — server, via MCP elicitation.
- Audit log — server.
- `run_shell`, `fs_read`, `fs_write`, `fs_delete` — server. These are plain Node
  child-process and file calls. They do not need the helper, and keeping them in
  the server means they are gated by the same policy engine as everything else.
- Flows (`run_flow`) — server. A flow is just a list of tool calls, and every
  step goes through policy like any other call. **No flow skips a gate.**

Rule: if it makes a decision, it lives in the server. If it touches the OS input
or screen, it lives in the helper.

---

## 7. Phase 0 status — done

- [x] Contract agreed (this file).
- [x] Folder layout created: `src/protocol/`, `src/server/`.
- [x] `policy.mts` carried across and extended. All old tests still pass.
- [x] Framing + handshake written and tested, including a fake helper driving a
      real Windows named pipe. 61 tests green.

### One honest exception

Phase 0 was meant to change nothing for existing users. It changes one thing:
**the default policy**. Terminal apps are no longer hard-blocked, and the risky
method list now covers the new tool names. That was the point of the rebuild, so
it ships now rather than later. It is recorded in the changelog.

### A flaw caught while building

The first draft of this protocol had the **server** send the token first. That
was wrong. A program that squatted the pipe name before the real helper started
would have been handed the token. The direction is now **helper proves first**,
which a squatter cannot do. See section 2.

A second gap turned up in the policy engine. It only ever gated on *argument*
patterns, which suited the old method names (`click`, `type_text`) where the
risk lived in the arguments. New tool names carry intent themselves, and
`\bdelete\b` does not even match inside `fs_delete`, because `_` counts as a word
character. So `fs_delete` classified as **allow**. Fixed by adding
`confirm.alwaysConfirmMethods`, for tools that gate on their name alone.
