---
name: computer-custom
description: Use when Computer Custom is explicitly selected, or a Windows task needs its prepared batches with countdown/Snooze, signed UIAccess helper, or saved local flows. Prefer bundled Computer for ordinary desktop tasks when available.
---

# Computer Custom

Prefer bundled Computer for ordinary desktop tasks when available. Select Custom
for an explicit request or one of its additional capabilities above. Custom has
its own MCP server and Windows helper; it does not initialize or wrap bundled
Computer. Both Codex and Claude Code use the packaged MCP tools.

## Prepare, execute, observe

1. Read `status` once for actual privileges, UIAccess and desktop availability.
2. Choose a window from `list_windows`; retain handle, PID and processStartTime.
3. Use `observe` without focusing. Combined mode gives compact controls and a
   window image; tree/image/targeted modes narrow the observation. Respect
   partial results and truncation. Window image offsets are in its metadata.
4. Prepare known steps together in `prepare_batch`. Each action has `op`,
   `target` and `args`. Coordinates are relative to the observed window.
   UIA element IDs belong to that window's latest observation.
5. Five actions queue automatically; `flush:false` defers a known script until
   its next dependency. Use `flush:true` for fewer actions or to flush an existing
   batch with `id` and `actions:[]`. A single flushed action runs immediately.
   Multiple actions get a five-second countdown with Snooze/Cancel, then run
   automatically for at most ten seconds.
6. Use `wait_batch` with the last revision. Completion includes the number of
   executed actions. Observe after UI changes or when the next step depends on
   a result; do not insert model turns between predetermined steps.

For page transitions, `invoke_element` also accepts
`args:{selector:{name:"Notifications",role:"button"}}` to resolve the live control
at execution. Selectors need an exact name or automationId; role narrows matches.
Use `wait_for` with `args:{name:"Expected heading",role:"text",timeoutMs:6000}`
when the next step needs a new page. Individual UIA calls remain bounded to two
seconds, and every wait shares the ten-second execution limit. Observed-control
`expect` conditions support value, name, focused and enabled properties.

Example arguments after observing a target and button:

```json
{"actions":[{"op":"invoke_element","target":{"handle":123,"pid":456,"processStartTime":"observed value"},"args":{"elementId":"observed button ID"}}],"flush":true,"title":"Open app settings"}
```

Direct `focus_window`, `click`, `key`, typing and UIA tools use the same queue
and complete their single action immediately. Saved flows collect known actions
until a dependency. Observations flush pending explicit batches; call
`flush_batch` before reporting completion. Saved flows also flush before sleeps
and on successful completion. Use `run_shell` and file tools for commands/files.

## Interruption and recovery

Snooze pauses all Custom sessions for five minutes and returns `resumeAt`.
Do independent work or wait until then; do not poll or replay the batch.
`cancel_batch` stops your batch. A failed/cancelled batch retains completed
progress: observe the current state before preparing any remaining actions.

`desktop_settings` persists threshold, notice, Snooze and input mode outside the
plugin cache. `block` suppresses physical input during execution. `ignore` leaves
physical input enabled and skips quiet-time waits; user input can interfere.
Ctrl+Alt+Del releases Windows input blocking. The overlay stop hotkey may not be
received during blocking. `HALTED` means the user stopped input; do not retry.

## Authorization and Windows limits

The host/model owns authorization. Carry existing user authorization through a
matching admin-consent prompt without another plugin confirmation by default.
Check the intended program/action. UIAccess and actual errors determine reach;
this helper cannot operate the secure desktop. On `SECURE_DESKTOP`, ask the user
to answer it. Never change UAC settings automatically.

Optional explicit policy files can still restrict actions. Relay their requests
without inventing confirmation phrases. `audit` records attempts with secrets
redacted. Report actual errors and completed progress, not assumed success.
