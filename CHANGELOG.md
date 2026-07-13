# Changelog

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
