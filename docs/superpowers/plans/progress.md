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
