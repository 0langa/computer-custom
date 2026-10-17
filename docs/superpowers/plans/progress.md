# SDD ledger — plan: docs/superpowers/plans/2026-10-17-prepared-desktop.md

## Current state

- Root: managed worktree named prepared-desktop, repository computer-custom.
- Branch: feat/prepared-desktop; base 003d752.
- 2026-10-17: confirmed original checkout clean and no previous implementation
  worktree/artifacts. Created managed worktree and installed locked dependencies.
- User approved complete plan and HUAWEI live testing; both-screen accuracy and
  real input suppression must be evidenced. Goal is active, not complete.

## Pre-flight interfaces

- Task 1 build/provenance feeds native helper startup (2) and release audit (7).
- Native target/operation/result contracts (2) feed scheduler (3), MCP (4),
  authorization (5), and fixture (6). Protocol changes versioned together.
- Scheduler states/events (3) feed MCP wait/status and overlay event handling.
- Task 5 ruling: user follow-up supersedes previous regex policy assumptions;
  default policy relies on host authorization. Keep optional explicit local
  restrictions, not blanket artificial restrictions.
- Do not run detached live jobs without retaining their actual session handle.

## Evidence

Baseline: npm test → 98 passed (native development helper was not built).
Task 1 package tests RED → missing installer project and missing binary manifest.
Native publish + package tests GREEN → 2 passed. Installer now ships source
and UAC script; native stage writes hashes only after successful compilation.
Full suite found flow reload collision: Date.now() cache key reused within one
millisecond. Deterministic frozen-clock reproduction RED; UUID import key fix.
Ruling: fix the existing flow reload race now because repeated prepared scripts
must execute current code — previously flaky test made deterministic.

Task 1 packaging/provenance foundation committed as 9b46041; suite 100 passed.
Measurement foundation continues with native fixture evidence under task 2/6.

Task 2 in progress: deadline/abort transport closes channels, unique elevated
startup files, parent lifetime watcher, process lifetime targeting, observation
generations, window-relative input, bounded native input leases and SendInput
cleanup implemented. Full suite before latest fixes: 117 passed.

Live recheck after user stopped competing session, 2026-10-17:
- Same occlusion failure persisted. Read-only window enumeration proved the
  fixture was hidden by its launcher (windowsHide:true); the covering HWND was
  ChatGPT, not evidence of another agent. Fixed fixture launcher and added
  visibility assertion before any takeover.
- HUAWEI: 20 ordered clicks, zero misses, 274.58ms total, p95 15.20ms.
- Alternating both monitors exposed asynchronous foreground transition. The
  subsequent diagnostic already saw the intended window focused. Added bounded
  polling of actual foreground after activation (no blind replay of clicks).
- Both monitors, block mode: 40/40 in order, 755.89ms total, p95 22.01ms.
- Both monitors, ignore mode: 40/40 in order, 757.39ms total, p95 22.35ms.
- Source ID for cross-monitor runs: 2d603476065df4b5. Real device interference
  was NOT exercised; these runs do not prove physical suppression yet.
- Signed helper installed for approved live verification, uiAccess=true,
  integrity=high. UAC configuration unchanged. Runtime sources remain in the
  managed implementation worktree; current installed plugin guidance unchanged.
- Elevation opt-out discovery regression reproduced: normal discovery chose
  the installed UIAccess executable despite requiring a different launch path.
  Normal discovery now selects bundled/development output.

Task 2 checkpoint (not task complete): full suite 124/124 passed, no skips.
- Real hung WinForms WM_GETOBJECT provider test: native worker survives past
  3.2s before fix (RED), exits itself at the 2s observation deadline after fix.
- Disconnect during that hang: no exit within 900ms before fix (RED), peer
  watcher exits worker with code 125 after fix. Overlapped pipe avoids blocking
  the independent watcher behind the serving thread's read.
- DesktopWorkers routes UIA reads/mutations to a separate worker from control;
  input/control remains responsive while the UIA provider is pending.
- Elevated launch now asynchronous; cancellation during startup is prompt and
  generation checks prevent resurrection. A native 5s connection deadline
  clears abandoned launch children. Connect retries have a total 3s deadline.
- Explicit operation deadlines include helper startup and terminate the native
  worker too. Existing input-lease watchdog now uses a disposal-safe deadline.
- Remaining task 2: combined/targeted observations, WGC window capture, broader
  target-state validation and acceptance cases. Tasks 3–7 still outstanding.

Observation checkpoint after 56c2b71:
- WGC HWND capture implemented using Windows SDK, without another automation
  runtime. Pixel test proved it captures the correct fixture while completely
  occluded: 648ms cold, measured window/image offset 7px on this display.
- Combined image + UIA observation returned 9 fixture controls in 268ms. Partial
  results retain the image when UIA fails; targeted results use window-relative
  bounds. Each combined call shares one 2s deadline including startup.
- Capture has a separate worker from input and UIA. Window-specific UIA
  generations retain other windows' views; refresh invalidates only that view.
  Cached elements validate the owning process lifetime before use.
- Native SDK target is Windows 10 19041, SDK package pinned 10.0.19041.57.
  The standard SDK projection adds roughly 25MB to the packaged helper.
- Native tests now build their fixture and development helper once before the
  parallel Node suite, avoiding shared-output build races and skipped tests.
- Task 2 core interfaces ready for coordinator; physical interference and the
  broader failure matrix remain acceptance work in task 6. No completion claim.

Coordinator/MCP checkpoint (tasks 3–5 core; acceptance still open):
- Shared authenticated named-pipe service is scoped by Windows SID/session.
  Two independent Node processes racing startup reached one service PID.
  Binary image replies stay binary on local IPC; disconnect and cancellation
  abort pending work. Startup cancellation RED (service launched after cancel)
  -> GREEN after lifecycle race fix.
- Scheduler defaults: threshold 5, visible 15s countdown, global 5min Snooze,
  10s native execution maximum. UI acknowledges display/hide. Real WinForms
  Snooze button defers two owners; request cancellation crossing a prepare
  reply also cancels its batch. Settings/Snooze persist outside plugin cache.
- Prepared 50-action run across displays 1,0: all controls/order and Unicode
  correct, 909ms execution after 15s notice (source 64fce7454801d549).
  This run used the coordinator engine locally, not the new daemon/MCP path.
- MCP now exposes observe/prepare_batch/status/wait/cancel/flush/settings.
  Legacy actions bind targets and join the queue; observations and successful
  flow completion/sleep flush pending work. Structured resumeAt is returned.
- Default policy now defers authorization to host/model. Prior restrictive
  rules remain an opt-in example. Automatic bundled-Computer hook removed.
  Skill and manifest discovery now prefer bundled Computer for ordinary work.
- Fresh-context discovery micro-test, five ordinary desktop prompts:
  old descriptions -> Custom 4/5, Computer 1/5; new descriptions -> Computer 5/5.
  Old reasons cited Custom's explicit Windows/Codex/screen wording. This is a
  small description-level sample, not a population selection-rate estimate.
  Revised guidance is not installed in the user's plugin cache yet.
- Full suite before startup-cancel addition: 165 passed (129 isolated/core,
  36 desktop integration), zero skipped. Startup-cancel pair now passes too.

Ruling: desktop integration test files run serially — hung UIA providers and
hotkeys share Windows state even across helpers, and simultaneous cold native
launches exhausted startup deadlines — cost: longer test runtime. Deliberate
multi-client competition remains concurrent inside dedicated tests. No product
observation or control deadline was relaxed.

Remaining: real daemon/MCP live acceptance, physical interference and release,
broader app/modal/DPI/failure matrix, actual bundled runtime benchmark, final
review, package/install lifecycle and source/docs consistency. Goal active.

Resumed 2026-10-17 after explicit pause; goal state active on recheck.
- The paused MCP run received Snooze before execution. Both clients closed;
  it supplies interruption evidence, not an execution pass.
- Physical block test source 5668183969033cc5: initial attempts inconclusive
  (one missing agent baseline; human missed timing). Added an explicit human
  START button and large phase labels to the test fixture. Valid run: agent
  baseline 14 chars before/during, pointer unchanged during 6.5s; after release
  field grew to 25 chars and pointer moved. Human confirmed inability to act
  during blocking and immediate X input after release. Physical block/release
  requirement now evidenced; ignore mode still pending.
- Found explicit partial prepare batches were invisible to dependency flushing,
  and observe did not select the target for subsequent legacy typing. Both
  reproduced RED, fixed, five adapter tests GREEN.
- Public scan RED on ignored local logs; scanner now uses tracked/unignored Git
  candidates and passes, retaining packaged-file checks.

Live acceptance checkpoint 2026-10-17 (tasks 3–6; not completion):
- Human ignore-mode test source 5668183969033cc5: actual mouse/typing remained
  active during 31 native key dispatches (p95 1.8144ms). Human confirmed no
  noticeable blocking. Physical block and release were separately confirmed.
- Real packaged stdio MCP, two clients: 92 actions across both screens, exact
  order/counts/Unicode verified, serialized owners; first execution 1313ms,
  second 33ms, each after the configured 15000ms notice. Source 70d106159ba6abce.
  Additional alternating UIA stress verified 40 asynchronous button effects.
- Earlier live runs exposed activation routing and asynchronous UIA effects.
  Bounded foreground reconciliation and explicit action effect expectations
  fixed those failures; clicks/actions are never replayed on ambiguity.
- Immutable Program Files version directories and atomic active.json activation
  tested, including corrupt-version rollback. Signed installed helper verified
  UIAccess/high integrity before activation. Current installation uses 70d106159ba6abce.
- Bundled runtime sample completed five real fixture actions (83–291ms each),
  with re-observation after geometry/user-activity interruptions. This sample is
  not a like-for-like complete workflow benchmark.

Ruling: waive the remaining 25%-of-bundled workflow benchmark — the human
explicitly accepted the 90-actions-in-two-seconds result and requested harder
admin/Codex/browser tasks instead — cost if wrong: relative performance on
unmeasured workflows remains unknown. Record discovery, notice and execution
separately for those tasks. Keep new live interaction on HUAWEI.

- Actual harmless admin request: secureDesktopActive=true within 820.8ms.
  Current policy is EnableLUA=1, consent=5, secureDesktop=1, unchanged by us.
  Signed UIAccess does not grant this helper access to that input desktop.
  Requested human response to the prompt. Desktop screenshot returned an
  unhelpful INTERNAL/invalid-handle error; improve its boundary reporting.
- README updated, but linked docs/PREPARED-DESKTOP.md still needs creation.
  Full suite must be repeated after recent installer/expectation changes.

Ruling: immediate single flushed actions; five-second multi-action countdown —
the human corrected the earlier interpretation and explicitly requested this
behavior — cost if wrong: a single action has no warning interval, as requested.
Persistent live setting updated to 5000ms; scheduler regression tests RED→GREEN.
This supersedes the original 15-second requirement. No approval hotkey promised:
the human offered either a hotkey or the shorter countdown.

Harder live acceptance and corrections:
- Codex unknown-path discovery reached Profile -> Settings -> Notifications ->
  Codex Push, without changing settings. 92s wall time included three old 15s
  notices; native execution totaled 111ms. Immediate single reset later took30ms.
- A prepared coordinate repeat failed at its readiness check after navigation.
  Added live exact selectors and wait_for conditions, with unique invocation
  matching and per-request UIA bounds. Script/flow deferral prevents one notice
  per five known steps. New behavioral tests observed RED→GREEN.
- Prepared UIA Codex path: four actions, 2863ms execution, one5000ms notice;
  independently observed the Codex Push control afterward.
- Real isolated Chrome on HUAWEI: Wikipedia search -> Ada Lovelace -> expand
  Biography -> Childhood. Input batches76/32/17ms; URL and visible anchor verified.
  Observations127–1883ms. No account state/settings modified.
- Browser canvas diagnostic proved a14-event down/move/up stroke. Chrome's
  textarea focused property did not become true despite subsequent key delivery;
  use actual value/effect verification for that provider, not assumed focus.
- Browser diagnostic reproduced empty KeyboardEvent.code for every key, despite
  correct key/modifier values. Filling the native scan field fixed it: actual
  Chromium events ControlLeft/Comma down/up,214ms for chord+canvas. Corrected
  helper then opened Codex settings with Ctrl+, in720ms (normal/ignore mode).
  Signed installed copy still needs this final source update.
- Shared-service reconnection after process death and per-owner helper/elevation
  preferences reproduced RED and fixed; mutations are not automatically replayed.
- Package build failed cleanly while its old overlay was running; previous
  complete binaries retained. Closed our diagnostic clients/browser and restored
  Codex chat; wait for coordinator idle retirement before rebuilding.
- Full suite caught the old one-action notice test and stale packaged binaries.
  Updated the Snooze test to two actions; complete package/suite rerun pending.
- UAC request returned to ordinary desktop; human asked for no further prompt
  until there is confidence in the path. Do not retrigger blind secure-desktop
  tests or change UAC policy. Screenshot boundary guard added; secure-desktop
  retest of that guard remains unperformed.

Checkpoint validation: npm run package PASS; npm test181/181 PASS (141 core,
40 desktop integration), no skipped/cancelled tests. Packaged source f7dd35c169b8e7af;
provenance now includes the overlay source identity and every native binary hash.
Actual Codex Ctrl+, regression is fixed and live-verified720ms after the browser
event-code RED→GREEN. No further bundled comparison is required (human reiterated).
This is a tested implementation checkpoint, not goal completion. Remaining:
recovery/failure and geometry acceptance, install/uninstall lifecycle, supported
host reload of guidance, final independent whole-branch review and completion audit.
