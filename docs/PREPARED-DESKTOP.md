# Prepared desktop architecture

The MCP server implements tool schemas, optional policy and local redacted audit.
It connects lazily to one authenticated coordinator per Windows user/session and
data directory. The coordinator owns FIFO scheduling, countdowns, shared Snooze,
cancellation and persistent settings. Each client owns separate native workers
and accessibility snapshots. Its helper path and elevation preference travel with
its connection; the first client does not choose privileges for later clients.

Input, UIA and capture use separate helper processes. A hung provider cannot hold
the input thread. Each UIA/capture request has a two-second default deadline,
including startup. Combined observation returns successful sources with errors
for failed sources. Window capture uses WGC and reports image/window offsets.

## Execution contract

`prepare_batch` accepts ordered `{op,target,args,expect?}` actions. A target is
`{handle,pid,processStartTime}` from observation. Coordinates are relative to that
window. Native execution checks identity, current bounds, focus and pointer hit
ownership again after the countdown. UIA IDs include a per-window generation;
refreshing one window leaves other windows' views intact.

Five actions queue automatically. `flush:true` queues immediately;
`flush:false` explicitly defers a known script. One flushed action runs without a
notice. Multiple actions get a five-second notice, then run automatically.
Snooze pauses all clients for five minutes. Neither Snooze nor cancellation
replays actions. Failed batches cancel later dependent work from the same owner.

The native input worker takes a per-session mutex and a lease of at most ten
seconds. `block` suppresses physical input; `ignore` keeps it enabled and ignores
activity-based quiet waits. Acquisition, input and release run on the same thread.
Peer/parent death, cancellation and independent watchdogs release control.
Ctrl+Alt+Del can release Windows input blocking; the overlay hotkey may not arrive
while blocking is active.

`expect` waits for an observed control's value, name, focused or enabled property.
`invoke_element` accepts either an element ID or an exact live
`selector:{name?,automationId?,role?}`; at least name or automationId is required.
Live invocation rejects multiple matches. `wait_for` waits for a visible control
with those exact fields. Its optional timeout is at most ten seconds, still
within the shared lease; each underlying UIA call remains bounded to two seconds.
UIA providers can acknowledge an action before its visible effect. Use readiness
conditions for dependencies and re-observe after a failed or ambiguous result.

Direct legacy MCP input tools finish a single bound action through this queue.
Observations, explicit
flush, flow sleeps and successful flow completion flush pending work. Known flow
steps are collected beyond the threshold until such a dependency. Flows are
trusted local JavaScript, with the same per-tool authorization and audit path.

## Authorization, installation and recovery

The host/model owns authorization. Default policy adds no keyword/title or
confirmation-phrase checks. Explicit restricted policy remains opt-in. Matching
admin consent carries existing task authorization. The current helper cannot
operate the secure input desktop and never changes UAC configuration itself.

The signed UIAccess helper is installed into immutable Program Files versions.
The installer verifies the complete binary set and actual runtime UIAccess
before atomically replacing active.json. Old running versions are retained.
Normal discovery uses the packaged helper; elevated startup uses ShellExecute
and a unique session file. Closing a client stops its workers and owned batches.
After coordinator failure, later requests can start a fresh coordinator; a failed
mutation is never automatically repeated and old UIA IDs must be discarded.

Data/settings are outside plugin cache. Update source and use the supported host
installation flow; editing the cache is unsupported. No automatic hook intercepts
bundled Computer. Prefer bundled Computer for ordinary discovery.

## Evidence and limits

Acceptance scripts in scripts/ exercise the packaged MCP transport, two owners,
two displays, ordered effects and Unicode. Physical input tests require a human
START and actual device attempts; a successful SendInput call proves neither
suppression nor application effects. Evidence stays under .cache/evidence.
Live Codex and browser tests also measure application readiness separately from
input execution. Broader compatibility is not implied by a passing fixture.
