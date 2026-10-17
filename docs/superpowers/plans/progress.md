# SDD ledger — plan: docs/superpowers/plans/2026-10-17-prepared-desktop.md

## Current state

- Root: managed worktree named prepared-desktop, repository computer-custom.
- Branch: feat/prepared-desktop; base 003d752.
- 2026-10-17: confirmed original checkout clean and no previous implementation
  worktree/artifacts. Created managed worktree and installed locked dependencies.
- User approved complete plan and HUAWEI live testing, including the temporary
  125% scaling test. Implementation and acceptance are complete with the explicit
  limits below. Local plugin 0.3.0 and signed helper 61e5b97a1b1f986e are installed.
- Final suite: 201/201 passing (161 core, 40 desktop integration), zero skipped
  or cancelled. Source integration remains the human's choice; no push or merge.

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

Recovery/target acceptance after455c9ce:
- Actual cancellation initially advanced the queue before native worker exit,
  producing CONTROL_BUSY in the following owner. Added condition-based native
  process exit waiting during cleanup; unit regression RED→GREEN. Real MCP
  cancel/disconnect/crash/timeout cases then all reacquired block mode with exact
  fixture counts:47ms/140ms/1394ms/1522ms recovery. Timeout configured1500ms.
- Restarted coordinator history previously trapped observations in NO_BATCH.
  Regression RED→GREEN: report BATCH_STATE_LOST once, discard stale tracking,
  permit a fresh observation without replay.
- Move-after-prepare and shrink-after-prepare passed with the installed helper.
  Modal-parent key input incorrectly succeeded (RED): disabled parent could
  redirect the key. Native IsWindowEnabled checks added before/after focus;
  actual modal-only run on the updated normal helper returns TARGET_DISABLED.
  Full signed/occlusion run awaits final helper installation. Both real display
  scales are1.0; mixed-DPI execution remains unmeasured (no display settings changed).
- Direct legacy actions now complete before returning, without a later flush;
  flow-scoped actions still batch until dependencies. Regression RED→GREEN.
- Uninstall checks active installed executables before deleting versions;
  path-boundary tests cover active/sibling paths. Immutable activation/rollback
  tests continue passing. Full real install/uninstall still requires Windows UAC.
- Packaged31-tool MCP smoke passes from C:/, including default host authorization
  and separate explicit restricted-policy behavior. The test's block probe is a
  harmless Write-Output string. Fixed the example window report's false exclusion
  of elevated candidates under high/UIAccess; regression RED→GREEN.
- Full suite187/187 passed (147 core,40 desktop integration), no skips.
  Current native package source f671efadff490e50. Installer readiness question
  pending; do not trigger another UAC prompt without the human's readiness reply.

Ruling: begin the required whole-branch source review while human-assisted final
signed installation is pending — implementation is ready and this review can
proceed without interrupting the human — cost if wrong: any later acceptance fix
falls after the pinned review and must receive its own regression verification.
Goal remains active; no completion claim and no publication/merge authorized.

Final whole-branch review received for003d752..0b1d999. No critical findings.
Re-grading before one TDD fix pass: Important1–7 all stand: synchronous-call
cancellation, policy/binding mismatch, selector snapshot invalidation, incomplete
selector uniqueness, held-input cleanup on forced exit, delayed notice lifetime,
and unbounded retained payload/history. Finding8 (stale direct-action guidance)
is Important in this product: agents are explicitly told successful synchronous
actions are merely queued, defeating the requested execution/observation contract.
All eight enter one fix pass; no second reviewer will be dispatched.

Final: Ruling: further bundled-speed comparison remains waived; the human again
accepts roughly one second per action — additional benchmark work would ignore
explicit steering — cost if wrong: no measured relative-speed guarantee.
Final: Ruling: latest signed helper and host reload are acceptance gates, not
source-review claims — reviewer did not run those live — cost if wrong: a source
pass could be mistaken for delivered behavior, so completion remains pending.
Final: Ruling: actual mixed-DPI transitions/content reflow remain unmeasured;
do not change the human's display settings for a benchmark — existing identity,
geometry and bounds checks remain the contract — cost if wrong: no mixed-DPI
runtime guarantee and content reflow still requires fresh observation.
Final: Ruling: secure-desktop screenshot guard is source-tested, not live-proven;
no secure-desktop input capability is claimed — cost if wrong: its new error
reporting may still differ on a genuine secure-desktop transition.
Final: Ruling: uncommitted saved-flow acceptance script is outside the pinned
review, but its actual thirteen-action/one-batch120ms execution and23ms direct
click evidence are valid acceptance evidence — cost if wrong: this diagnostic
script has author verification only.

Human answered Ready now for the install. Real signed f671efadff490e50 installer
rejected its protected startup/UIAccess check and then hit a transient DLL lock
during rollback cleanup, masking the original check error. Previous active
70d106159ba6abce pointer remained intact. A subsequent read-only check of the
candidate from the ordinary host passed UIAccess/preparedInput in403ms. Do not
re-prompt before diagnosing and improving startup diagnostics/release cleanup.
Supported local plugin/read accepts an explicit marketplace JSON path and a
relative local plugin source, preserving computer-custom@0langas-plugins. This
provides a supported install route without altering the remote marketplace or
editing installed cache; installation itself is still pending.

Final fix-pass evidence (before delivery):
- Findings1/6: real IPC direct-call and flow-abort regressions initially left
  queued work behind; adapter-owned cancellation RED→GREEN. Notice lifetime and
  repeated-Snooze regressions initially showed hidden-before-shown stale notices;
  retaining notice ownership through creation/hide completion is GREEN.
- Finding2: three actual DesktopSession/tool-policy regressions reproduced wrong
  foreground authorization/selection; resolve the bound target and execute that
  same binding, without default-policy overhead or incidental flush, RED→GREEN.
- Findings3/4: mixed selector/observed-ID batches and truncated unique queries
  failed RED. Internal snapshot generations preserve observed IDs; incomplete
  depth/node/provider traversal cannot establish uniqueness. Native35-query
  retention and external-refresh invalidation pass; focused tests GREEN.
- Finding5: a REAL killed-worker drag left mouseDowns1/mouseUps0/leftDown=true
  (RED); diagnostic recovery released that button. Balanced one-transaction drag
  is GREEN with signed installed61e5b97a1b1f986e: workerGone=true, down1/up1,
  twelve dragging motions, and actual system button state released.
- Finding7: terminal payload/bounded-history regression RED→GREEN: action data is
  cleared immediately, at most256 summaries live for five minutes, and owner
  disconnect removes its terminal history. Recent preparation/cancel mappings
  are bounded and expire after30s; the redundant owner map was removed.
- Finding8: synchronous direct-tool guidance aligned with actual behavior and
  verified through the real installed MCP instructions plus completed direct
  calls. No implementation-mirroring copy test added.
- Extra install defect: original error masked by locked rollback file, reproduced
  RED→GREEN. Checker awaits native exit before retry/success; explicit captured
  stdout/stderr/exit diagnostics pass real Windows PowerShell tests, including
  spaces and multiple Node executables on PATH. Original cold verification
  cause was not conclusively established; do not claim a guessed cause was fixed.
- Complete package build and suite201/201 pass (161 core/40 integration), no
  cancelled/skipped tests; packaged31-tool MCP and public scan pass.

Final: Ruling: eliminate synthetic holds across syscalls by submitting balanced
drag down/motion/up together, instead of adding a persistent recovery guardian —
the real forced-kill test proves Windows delivers release independently after
dispatch — cost if wrong: apps requiring the old96ms drag pacing may need an
explicit timed-gesture design. Chrome canvas and WinForms motion/release pass.
Final: Ruling: retain shared notice ownership until pending creation and hide
settle, including repeated Snooze — no late show can replace the next owner's
notice — cost if wrong: a slow overlay creation delays the queue until its bounded
startup deadline, without taking desktop control.

Delivered/lifecycle acceptance:
- Human approved retry readiness. Main signed61e5b97a1b1f986e installation passed
  and activated versions/61e5b97a1b1f986e-0cee2d7e. Isolated protected-directory
  install, upgrade retaining the old version, corrupt-copy rollback, actual
  uninstall and unique certificate removal all passed. Primary UAC policy was
  not changed. Evidence .cache/evidence/install-lifecycle.json.
- Full signed target test passes move-after-prepare, shrink rejection, disabled
  modal-parent rejection and real occlusion rejection. The fixture's managed
  TopMost flag initially did not establish a covering window; reasserting it
  after Show and independently checking WindowFromPoint fixed the diagnostic.
- Recovery rerun against installed61: exact application counts, block reacquired;
  cancel30ms/disconnect26ms/coordinator-crash1236ms/1500ms timeout1524ms. The old
  diagnostic blindly requeued after crash and got five clicks; it now measures
  the prior effect and never repeats a completed click before proving release.
- Saved flow: thirteen actions/one batch114ms, one5000ms notice; direct click23ms.
- Real isolated Chrome chord/canvas on signed61:40ms, expected physical key codes,
  six actual pointer events with final endpoint/up. Cold Chrome only exposed
  browser chrome until its owned window was activated; the diagnostic now waits
  for actual controls. It uses a separate profile with renderer accessibility.
- Actual Codex live selector navigation plus expectation on an observed settings
  field succeeds in1660ms for three steps, one5000ms notice. Observed ID survives
  internal queries; Codex Push confirmed and Back restores the chat. No settings
  were changed. Evidence .cache/evidence/codex-final-selectors.json.
- Supported plugin/install with explicit local marketplace JSON installed0.3.0
  under the SAME computer-custom@0langas-plugins identity. Remote marketplace
  configuration remains intact. plugin/installed reports localVersion0.3.0.
  Real MCP launched from the installed cache advertises31 tools/version0.3.0,
  grants actual UIAccess, matches source/bundled instruction hashes and source61.
  Existing already-running sessions can retain their prior loaded instructions.

Final: minor (deferred): the first rejected inactive protected candidate
versions/f671efadff490e50-11322dec remains partly present after the original
locked rollback; it is not active. Removing that diagnostic remnant alone does
not justify another UAC prompt; ordinary uninstall removes installation versions.
Remaining explicit limits: no actual mixed-DPI display transition, and no new
secure-desktop screenshot-guard runtime check. No secure-desktop input support
is claimed. Completion audit and local branch preservation remain pending.

Final mixed-DPI acceptance and completion audit, 2026-10-17:
- Human explicitly authorized changing only HUAWEI to 125% and restoring 100%.
  The fixture now declares PerMonitorV2, so DeviceDpi measures actual per-display
  DPI rather than virtualized coordinates. HUAWEI measured120; primary96.
- Real packaged MCP, signed source61, two owners: 92 actions, exact counts/order,
  physical clicks, Unicode typing, UIA mutations and focus stress all pass.
  First90 execute in1246ms; second2 in41ms, serialized, one5000ms notice each.
  Evidence .cache/evidence/mixed-dpi-batches.json and mixed-dpi-observed.json.
- Restored HUAWEI via the observed 100% control. Fresh independent fixture reports
  screen1/dpi96; evidence .cache/evidence/mixed-dpi-restored.json. Returned Settings
  to the primary display and minimized it; closed the owned loopback bridge.
- Final npm test201/201 PASS, npm run verify:packaged PASS (31 real MCP tools,
  default host authorization plus explicit restricted policy), public scan PASS,
  git diff --check PASS. Original main checkout remains clean.
- Fresh installed-cache smoke confirms0.3.0,31tools,actual UIAccess, matching
  server/guidance hashes and helper source61. No further installation is needed
  for the final test-fixture/documentation changes.

Final: Ruling: the user's explicit 125% authorization supersedes the earlier
mixed-DPI deferral. Actual mixed-DPI acceptance and restoration are now proven;
arbitrary future content reflow still requires a fresh observation. The status
scale1 field means physical-pixel coordinate conversion, not actual UI scaling;
documentation now makes that distinction explicit — cost if wrong: consumers
must obtain actual UI DPI separately rather than infer it from this field.

Completion audit against all seven tasks:
1. Packaging/provenance: reproducible native inputs, source/binary identities,
   shipped installer inputs, real signed install/upgrade/rollback/uninstall pass.
2. Native execution: target identity/current bounds/focus/hit checks, independent
   workers, bounded provider hangs, physical block/ignore and recovery evidenced.
3. Shared coordinator: persistent settings, FIFO owners, five-second notice,
   immediate singles, Snooze/cancel/release and bounded history verified.
4. MCP/flows: packaged31-tool protocol, synchronous direct actions, deferred
   thirteen-action saved flow, cancellation propagation and readiness verified.
5. Authorization/guidance: host-owned default, optional restrictions, matching
   bound-target policy and bundled-first guidance installed. Discovery microtest
   new guidance5/5 bundled vs baseline4/5 Custom; this is a small sample, not a
   guarantee about future agent selection or already-loaded sessions.
6. Acceptance: native two-display/mixed-DPI accuracy, actual physical input,
   Codex unknown-path/prepared navigation, real browser/canvas, signed elevated
   runtime and failure/geometry cases pass. Further bundled timing waived.
7. Independent pinned whole-branch review completed; all eight findings fixed
   in one pass with behavioral evidence. No second reviewer dispatched. Full
   current-tree suite and delivery checks pass; no publication is implied.

Remaining limits: secure-desktop input is unsupported, and the new screenshot
boundary guard has source coverage but no fresh live secure-desktop error-path
check. UAC policy remains unchanged. The sole deferred minor is the inactive
partly cleaned rejected install candidate recorded above. Existing sessions can
retain old plugin instructions; new sessions load the installed0.3.0 guidance.
No owned fixture, browser-profile or desktop-bridge processes remain. This audit
closes implementation and verification; source integration awaits the human's
decision.
