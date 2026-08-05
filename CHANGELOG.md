# Changelog

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
