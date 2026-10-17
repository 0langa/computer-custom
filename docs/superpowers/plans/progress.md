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
