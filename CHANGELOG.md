# Changelog

## 0.2.2 — the update check stops crying wolf

- **Fixed a false alarm.** The check for an out-of-date elevated helper compared
  file modification times, so a plugin reinstall or a git checkout made the
  bundled file newer without a line of helper code changing, and every elevated
  session told the user to re-run an elevated installer for nothing. Found by a
  full test run on a real machine: the installed binary was *newer* than the
  last change to helper source and was still called stale. The proof was that
  one release gave two answers — the Claude plugin cache (checked out 20:55) and
  the Codex one (20:36) hold byte-identical helpers, yet only Claude warned about
  the same Program Files install (20:49). The verdict depended on install order,
  not on code.
  The comparison is now a hash of the helper's source tree
  (`scripts/helper-build-id.mjs`), written to `helper/build-id.txt` by the build
  and beside the installed copy by `install-elevated-helper.ps1`. The binaries
  themselves can never be compared: only the installed one carries the uiAccess
  manifest and a signature. When either id is missing the check says nothing,
  because a question it cannot answer must not be answered with a warning.
- Added `npm run verify:packaged`, which drives the packaged plugin as a real
  MCP client over stdio from `C:\`, the way Claude Code and Codex do. It checks
  the tool surface, a read-only call, both hard-block behaviours, and all three
  confirmation routes — declined, wrong phrase, exact phrase — asserting after
  each that the target file was left alone or removed as appropriate.
  The in-process unit tests never watched a gate actually refuse anything.

## 0.2.1 — Codex MCP registration

- Added the missing Codex `mcpServers` manifest entry and a Codex-native MCP
  configuration with plugin-root-relative paths. Codex now starts the bundled
  server after marketplace installation without a manual `config.toml` block.

## 0.2.0 — self-contained rebuild

Phase 0 of the rebuild described in `docs/REBUILD-DESIGN.md`. The plugin is
moving off the OpenAI `@oai/sky` runtime and onto its own MCP server plus a
native helper, so it works in Claude Code and Codex with nothing else installed.

- Added the server↔helper wire protocol: length-prefixed framing, typed
  operations and error codes, and a token handshake (`src/protocol/`).
- Added the helper transport client with request correlation, timeouts, binary
  screenshot frames, and typed failures (`src/server/helper-client.mts`).
- Added `classifyToolCall` so MCP tool calls and legacy `sky` calls share one
  policy engine and one config file.
- Added `confirm.alwaysConfirmMethods` for tools that must gate on their name
  rather than their arguments. Without it `fs_delete` classified as `allow`,
  because `\bdelete\b` does not match inside `fs_delete`.
- **Changed default policy**: terminal applications are no longer hard-blocked.
  Shell access is now gated through the upcoming `run_shell` tool and its
  patterns, so destructive commands confirm while ordinary ones pass. Drive
  formatting and secret exfiltration remain hard-blocked.
- No provider behaviour change yet beyond the default policy; the new server is
  not wired into either client until phase 1 finishes.

### Phase 1, part 1 — the native helper

Added `helper/ComputerCustom.Helper`, a C# executable that owns all OS input,
screen capture and UI Automation. Verified end to end against the live desktop:
handshake, window listing with integrity levels, PNG capture, cursor position,
UI tree, and typed error codes.

- Input goes through `SendInput` with absolute virtual-desktop coordinates, not
  `SetCursorPos`, so games and applications that ignore a teleported cursor
  still receive it.
- The helper declares per-monitor DPI awareness at startup; without it every
  coordinate and capture is wrong on a scaled display.
- `DesktopGuard` detects the secure desktop and returns `SECURE_DESKTOP` rather
  than letting input vanish into a UAC prompt.
- `ui_tree` prunes to actionable elements by default and reports `truncated`.
  Measured: an unpruned Notion window is 1692 nodes and ~166 KB of JSON; the
  bounded default returns 215 nodes and ~44 KB.
- Text is typed as Unicode code points, so results do not depend on the active
  keyboard layout.
- The public-safety scan now skips `bin/` and `obj/` output anywhere in the
  tree, which otherwise reports machine paths that are already git-ignored.

### Phase 1, part 2 — the MCP server

The plugin now serves 18 tools over its own MCP server, with no `@oai/sky` and
no provider runtime. Verified by driving the packaged plugin as a real MCP
client from a directory with no `node_modules`.

- Added the stdio MCP server: tools, policy gate, confirmations and audit
  (`src/server/`). Read-only tools pass; gated tools ask; blocks fail closed.
- Confirmation uses MCP elicitation when the client supports it, falls back to
  an exact phrase relayed by the agent, and **refuses** when it can reach
  neither. A gate that opens when it cannot ask anyone is not a gate.
- **Input calls are now classified with the focused application attached.**
  Without this the policy's application rules were dead code for input: a click
  is two numbers, so nothing about installers, admin tools or security software
  could ever match, and every click classified as `allow`. The confirmation
  prompt and the audit entry both name the target application.
- Added the `foreground_window` and `audit` tools.
- `ui_tree` gained `interactiveOnly`, `maxNodes` and a `truncated` flag, and its
  default depth rose to 25 after measuring that depth 8 made rich windows look
  empty.
- The server ships as one bundled file (~1.4 MB) and the helper publishes to
  ~258 KB, so an installed plugin needs no npm install.
- Claude Code gets the server through the plugin's generated `.mcp.json`; Codex
  through `config.toml`. Both read the same policy file.
- Rewrote the skill for the new contract and replaced the test that asserted
  the old `@oai/sky` bootstrap with one asserting the self-contained one.
- **Release helper builds no longer embed machine paths.** The default portable
  pdb wrote absolute source paths, including the build user's name, into a
  binary meant for public distribution. Release now builds with `DebugType=none`
  and ships no symbols. The public-safety scan caught this.
- `npm run build` no longer wipes the published helper out of `dist/`. The
  helper comes from `dotnet publish`, so any `npm test` used to silently gut the
  packaged plugin.

### Phase 2 — shell, files and flows

Six more tools, for 24 in total.

- `run_shell` runs a command directly and returns stdout, stderr and the exit
  code. Typing into a terminal window with synthetic keystrokes was always the
  worse option: slower, lossier, and it hands back pixels instead of output.
- `fs_read` (files and directory listings), `fs_write` (write or append) and
  `fs_delete`. Delete always confirms, refuses a non-empty directory without
  `recursive`, and its prompt names what is actually there, so "delete this
  folder" cannot quietly mean "and the four hundred files in it".
- **Saved flows** as JavaScript: `list_flows` and `run_flow`. Flows get real
  loops and conditions, but every tool call inside one goes through the same
  invoker the agent uses, so no flow can reach a tool by a route that skips the
  gate, and a refused step stops the flow. Flow names are treated as bare
  identifiers, so one cannot walk out of the flows directory. The flow's own
  JavaScript is deliberately **not** sandboxed and the docs say so plainly: it
  is the user's code, running as the user.
- Fixed shell timeout detection. Node signals a timeout by killing the child and
  setting `killed`, not by setting `ETIMEDOUT`, so a runaway command was being
  reported as an ordinary failure with no hint it had been cut short.
- Added 23 tests covering shell, files, deletion guards and flows.

### Phase 3 — signing and elevation

The helper can now be installed so it drives elevated application windows,
without elevating Claude Code or Codex themselves.

**Measured from a non-elevated session**, which is how the clients actually run:
the signed helper is granted `integrity: high` and `uiAccess: true` with no UAC
prompt, where the unsigned build gets `medium` and `false`. That is the
capability Windows requires before synthetic input may reach a higher-integrity
window.

**Demonstrated end to end** against an elevated PowerShell 7 window, from a
non-elevated session. Identical action, same window, seconds apart:

| helper | typed text arrived |
| --- | --- |
| unsigned, medium integrity | **no** |
| signed, high + uiAccess | **yes** |

Getting there took two retractions worth recording, because both were the same
mistake — treating an unrestricted operation as evidence:

- Focusing an elevated window and reading its accessibility tree were first
  reported as "UIPI crossed". A control run showed an unsigned helper doing
  both. `SetForegroundWindow` follows foreground-activation rules and UIA reads
  are permitted; UIPI restricts neither.
- The replacement probe read the typed text back through UI Automation and
  reported failure for input that had visibly landed on screen. A failed READ is
  not failed INPUT. The check now compares a screenshot before and after, and
  returns *inconclusive* rather than *failed* when the window is not frontmost,
  since a capture of screen coordinates photographs whatever covers it.

- Added `scripts/install-elevated-helper.ps1`. It creates a self-signed
  code-signing certificate trusted on this machine only, signs a `uiAccess`
  build of the helper, and installs it into Program Files. **Free**: no
  certificate authority is involved. Nothing is left running in the background.
  Fully reversible with `-Uninstall`, and `-DryRun` prints every change without
  making one and needs no admin rights.
- **The elevated helper is launched through ShellExecute, never CreateProcess.**
  The first design used a scheduled task and could not work: only the AppInfo
  service issues a UIAccess token, and CreateProcess never asks it. Measured —
  `spawn` returns `EACCES`, a scheduled task returns `ERROR_ELEVATION_REQUIRED`
  (740), `Start-Process` without redirection works. No UAC prompt appears. The
  scheduled task was removed, and the installer unregisters one left behind by
  the earlier version.
- The helper is now built as `WinExe`. ShellExecute cannot hide a console the
  way CreateProcess can, so a console-subsystem helper flashed a black window on
  every elevated launch.
- Added `npm run verify:elevation`, which checks every prerequisite, starts the
  helper, and with `--focus` proves the point against a real elevated window. It
  excludes the helper's own window: focusing that would prove nothing.
- Added `app.uiaccess.manifest`, applied only under `-p:UiAccess=true`. The
  development build deliberately has no manifest, so an unsigned helper never
  requests a privilege it cannot be granted.
- The helper accepts `--session-file` as well as `--pipe` plus stdin. A
  scheduled task has no stdin and fixed arguments, so per-run values go through
  a file in the user's LocalAppData that the helper deletes on read. This is
  weaker than stdin, which is why elevated mode is opt-in
  (`COMPUTER_CUSTOM_ELEVATED=1`) and documented as such.
- `status` now reports how the helper was started, not just what it is. When
  elevation is requested but the signed helper is not installed, the session
  **falls back to normal privilege and says so**, rather than failing or quietly pretending.
  It never elevates on its own, which would mean an unrequested UAC prompt.
- The helper is now discovered at its installed Program Files location first.
- The installer's dry run no longer requires administrator rights: you should be
  able to read exactly what a script will do before granting it any.
- Added 6 tests covering start modes, the fallback notice, that no session token
  is left on disk, and that integrity **inherited** from an already-elevated
  parent is not mistaken for a genuine elevated start — reporting it as such
  would tell the agent it can reach windows it cannot.

**Correction, measured later in Phase 4:** the claim above — repeated
throughout earlier notes — was too strong. Signing alone does not reach the
consent prompt, which is correct. But with the secure desktop *also* off, a
coordinate click from the signed `uiAccess` helper **does** reach it and grants
elevation. Verified on a real machine. `ui_tree` still cannot read the prompt,
because it runs at system integrity, so it has to be driven from a screenshot.

### Phase 4 — the UAC secure-desktop opt-in

- Added `scripts/uac-secure-desktop.ps1`. Reporting the current setting is the
  default and needs no admin rights. `-Disable` refuses without `-IUnderstand`,
  and `-Minutes` registers a one-shot task that restores the secure desktop
  automatically, so a forgotten setting cannot leave the machine exposed. It
  changes exactly one value, `PromptOnSecureDesktop`; it never touches UAC's
  prompt behaviour and never disables UAC.
- The script states the real cost rather than the convenient half of it:
  turning the secure desktop off does not grant this capability to Computer
  Custom, it grants it to every program running as the user. The secure desktop
  is what stops software approving its own elevation prompts.
- The helper now **reads** `EnableLUA` and `PromptOnSecureDesktop` and reports
  them through `status`, so the agent can tell the user whether a UAC prompt is
  reachable instead of assuming. Nothing in the plugin ever writes them.
- **Stale-install detection.** The elevated helper is signed and installed
  separately, so a plugin update leaves it untouched and elevated sessions can
  silently run months-old code. The server compares it against the bundled
  helper and reports a notice through `status`. This immediately caught a stale
  install on the development machine.
- **Measured: a UAC consent prompt can be answered, given both halves.** With
  the secure desktop off and the signed `uiAccess` helper running, a coordinate
  click on the prompt granted elevation. `ui_tree` returns 1 node and no
  buttons for it — the prompt is system integrity and `uiAccess` does not reach
  system UI for reading — so it must be driven from a screenshot.
- Consequently, `consent` and the prompt's window title were added to the
  confirmation patterns. Approving an elevation request is now something the
  agent can do, so it must never happen without asking. Three tests cover it.

## 0.1.6 - 2026-09-09

- Initialize against the current host-provided `@oai/sky` API instead of requiring an obsolete bundled client filename.
- Accept an injected official API, preserve explicit legacy-client support, and rewrap a replaced global API.
- Read the installed official skill's documentation files rather than calling the removed `sky.documentation` method.

## 0.1.5 - 2026-08-05

- Added Windows source-validation CI and stabilized generated public-plugin text files.
- Ignored local RECALL state; no provider runtime behavior changed.

## 0.1.4 - 2026-07-27

- Fixed skill bootstrap skipping custom wrapper when official Computer Use initialized `sky` first.
- Required live official guidance and confirmation docs before Windows control.
- Changed explicit security-setting and administrative-tool actions from custom hard blocks to exact confirmation.
- Stopped blocking ordinary Windows and Program Files path entry by default.
- Documented provider/runtime and UAC secure-desktop capability boundaries.
- Added init-order and policy regression coverage.

## 0.1.3 - 2026-07-13

- Improved skill discovery for live Codex and Claude Code Windows testing requests.

## 0.1.2 - 2026-07-13

- Fixed Codex bootstrap when `process` is unavailable inside current JavaScript runtime.
- Fixed missing Windows environment values collapsing protected roots to `.` and blocking ordinary app actions.
- Allowed read-only inspection regardless of protected app path and limited protected-root checks to entered values.
- Changed antivirus and security-tool input from unconditional block to exact-phrase confirmation while preserving security-disable hard blocks.
- Added one-shot chat confirmation fallback for Codex runtimes without inline elicitation.
- Made setup idempotent and added audit records for policy-blocked and confirmation-denied attempts.
- Added policy and runtime regression coverage.

## 0.1.1 - 2026-07-11

- Added Claude Code guard integration and marketplace artwork.
