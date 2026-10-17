# Computer Custom

Prepared Windows desktop automation for Codex and Claude Code. Prefer bundled
Computer for ordinary desktop work; select Custom for prepared batches with a
countdown/Snooze, the signed UIAccess helper, or saved local flows.

## Execution

Read `status`, choose a window from `list_windows`, and use `observe` without
focusing. Prepare ordered actions with window/process identities and
window-relative coordinates. Five actions queue automatically; `flush:true`
queues a smaller batch. Single flushed actions execute immediately. Multiple
actions get a visible five-second countdown with Snooze/Cancel, then execute
automatically for at most ten seconds. `wait_batch` returns progress
or a shared `resumeAt` when snoozed. Do not replay completed actions.

Known dependencies can have an `expect` condition on an observed control's
value, name, focus or enabled state. The batch waits locally for that state,
within its execution deadline, before continuing. UIA providers can return
before their visible effects; use a condition when a following step depends on
those effects.

For navigation, `invoke_element` can resolve an exact live `selector` with name,
role or automationId. `wait_for` waits for a visible control after a page change.
Both run locally; they do not replay input. Selectors that match multiple controls
are rejected before invocation. Individual UIA requests retain a two-second cap.

Direct click/key/type/focus tools finish their single action through the same
queue. Observations and
`flush_batch` flush pending work. Saved flows also flush before sleeps and
successful completion. Known flow steps stay together beyond the threshold until
a dependency flush. Commands/files use direct tools; local JavaScript flows
run as trusted user code and are not sandboxed.

## Architecture

Codex/Claude → MCP stdio server → authenticated local coordinator pipe →
one queue per Windows user/session → isolated native input, UIA and capture
workers. A separate WinForms overlay shows countdowns and handles Snooze/Cancel.

The coordinator serializes clients. Native input has a Windows session mutex,
a maximum ten-second lease, an independent release watchdog, and peer/parent
lifetime checks. UIA and capture have separate workers and two-second observation
deadlines. Window capture uses Windows.Graphics.Capture, including occluded
windows. Combined observations retain useful partial results.

See [the current architecture and API](docs/PREPARED-DESKTOP.md) and
[the native protocol](docs/PROTOCOL.md). Earlier rebuild design notes are historical.

## Input and authorization

- `block`: physical mouse/keyboard input is suppressed only during execution.
- `ignore`: user input remains enabled; activity does not abort dispatch.
  Concurrent user input can affect the application.
- Snooze pauses all Custom clients for five minutes.
- Ctrl+Alt+Del releases Windows BlockInput. The overlay hotkey may not be
  received while physical input is blocked.

Host/model authorization is authoritative. Default policy adds no keyword,
title or confirmation-phrase gates. Already-authorized work can include matching
admin consent. This helper cannot operate the secure desktop and never changes
UAC settings automatically. Actual UIAccess/integrity and errors determine reach.

Optional explicit local restrictions remain available in
`config/example-restricted-policy.json`. Audit records are local and redact
common secrets. Custom registers no hook on bundled Computer.

## Install and settings

Install/update through the host's plugin flow, then restart the client to load
the new package. Both providers launch the bundled MCP server; no global MCP
configuration is needed. Build output is `dist/computer-custom`.

For UIAccess, inspect `scripts/install-elevated-helper.ps1 -DryRun`, then run
the installer from an elevated PowerShell. It builds and signs the helper,
trusts a local code-signing certificate, and installs into Program Files.
A complete version is verified before an atomic activation-pointer switch;
older running versions are retained. Startup uses ShellExecute. The installer
verifies actual UIAccess before activation and leaves UAC settings unchanged.

UIAccess is used when installed; set `COMPUTER_CUSTOM_ELEVATED=0` to opt out.
Uninstall with the same script's `-Uninstall` option after closing Custom sessions.

`desktop_settings` persists batch threshold, notice, Snooze, input mode and
control duration outside the plugin cache. Defaults: 5 actions / 5 seconds /
5 minutes / block / 10 seconds. Data lives under
`%LOCALAPPDATA%/computer-custom`, or `COMPUTER_CUSTOM_DATA`.
Point `COMPUTER_CUSTOM_FLOWS` outside the plugin cache to preserve your flows.

## Development and verification

```powershell
npm ci
npm run package
npm test
npm run scan:public
```

Packaging builds the MCP bundles and native helpers with actual binary hashes.
The .NET 10 SDK and Node 22+ are development prerequisites. Desktop integration
tests share real Windows UIA/hotkey resources and run serially; explicit
competing-client tests retain their intentional concurrency.

Live tests are opt-in and affect clearly labelled fixture windows:

```powershell
node scripts/verify-mcp-batch.mjs 1,0 --focus-stress
node scripts/verify-physical-input.mjs block
node scripts/verify-physical-input.mjs ignore
```

Physical tests wait for START and require a human to move/type. Evidence and
measurements are saved locally in `.cache/evidence`; a successful SendInput
return alone is not proof of physical suppression or application effects.

## Privacy

Desktop traffic stays on local pipes. Native workers authenticate with per-run
tokens and user-scoped pipe ACLs; coordinator clients use challenge/HMAC proofs.
Flows and shell tools can access the network when the requested user script does.

## Terms

Use this plugin for automation you are authorized to perform on machines you
control. Host/model restrictions still apply.
