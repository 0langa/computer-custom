# Prepared desktop implementation plan

Approved in the task conversation, 2026-10-17. Execute inline with
superpowers:executing-plans. Do not re-request design approval.

## Goal and binding requirements

Make Computer Custom fast, reliable, and predictable against bundled Computer
as the benchmark. Preserve independent MCP + native Windows architecture,
Codex and Claude Code support, plugin identity, shell/files, and trusted flows.
Bundled Computer wins ordinary discovery; Custom is selected explicitly or for
additional capabilities. Model/host authorization is authoritative; remove
redundant keyword and magic-phrase gates by default. User-authorized tasks may
include matching admin consent. Do not change UAC configuration automatically.

Prepared operations are target-bound and run locally without model round trips.
Persistent settings default to five actions, 15-second notification countdown,
five-minute snooze, and ten-second maximum takeover. Partial batches flush for
dependencies/completion. Notice does not require acknowledgment. Suppress user
input during exclusive execution; never hold input while the model reasons.
Control releases on finish, cancel, unexpected UI, timeout, disconnect, crash.
Provide cancellation and an independent release watchdog. Settings outside
plugin cache survive upgrades. Multiple Custom sessions serialize desktop use
and share snooze. Snooze returns structured resumeAt so the agent can do other
work or wait. No cross-chat messaging dependency.

Observation: compact combined response, screenshot/tree/targeted modes; real
window/process identity and observation generation; window-relative input;
execution-time target/occlusion validation. UIA worker isolated and restartable,
two-second default timeout. WGC window capture, desktop capture as needed.
Native SendInput sequences with cleanup of held keys/buttons.

Provenance: build identity describes actual compiled binary; installer ships
inputs it needs; reliable elevated launch, per-session startup files, tracking,
cleanup; no automatic interception of bundled Computer. Measure startup,
observation, authorization, queue/countdown, execution, recovery separately.

## Tasks

1. Packaging/provenance and measurement foundation. Fix stale source stamps;
   package helper source/scripts for elevation; timings and stable evidence.
2. Native targeting, bounded observation worker, input batch execution and
   suppression/watchdog. Protocol owns target identities and result progress.
3. Coordinator/settings and notification UI. Shared session queue, countdown,
   snooze, cancel, threshold/flush, owner disconnect and lease deadlines.
4. MCP batch API and legacy tool/flow adapters. prepare_batch, batch_status,
   wait_batch, cancel_batch; no alternate unannounced foreground route.
5. Authorization and guidance cleanup. Host-owned consent, optional explicit
   user policy, no title regex ceremony, scoped admin authorization, honest
   capability results; bundled-first discovery and no automatic wrappers.
6. Windows fixture and repeatable acceptance/benchmarks. Native, Electron,
   browser, canvas, elevated, mixed-monitor/DPI, failure injection; actual
   bundled runtime comparison. User authorizes live work on HUAWEI display
   and demands measurable sequence accuracy across both screens in one flush.
7. Independent whole-branch review, fixes, packaging and completion audit.

## Verification contract

Use behavioral RED→GREEN tests per task, then suite checks. Warm simple dispatch
p95 <250ms; observations return/time out in 2s; no takeover >10s; zero wrong
targets in regression runs; common task execution within 25% of bundled tool
(exclude intentional notice/snooze). Prove blocking and ignoring physical input
as well as release, not merely synthetic delivery. Test competing sessions,
held keys, occlusion, geometry/DPI changes, stale identities, unexpected modals,
provider hangs, disconnect/cancel races, crashes, repeated snooze. Test packaged
install/upgrade/uninstall and bundled-first agent selection. Do not mark the
goal complete with unmeasured claims or missing requirements.

## Decisions

Implementation may refine interfaces as evidence requires; document rulings
in progress.md. User expressly wants unnecessary safeguards removed, not another
approval product. Native target/lease correctness protects input accuracy;
host guardrails own intent. No publication/merge implied by implementation.
