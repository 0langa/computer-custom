---
name: computer-custom
description: Policy-controlled Windows Computer Use wrapper for Codex and Claude Code
---

# Computer Custom

Adds a policy layer on top of Computer Use: hard-blocked system paths and actions, confirmation for risky actions, and a redacted audit log. The policy rules are shared across providers; only the wiring differs.

## Policy

- Read-only discovery calls normally pass through.
- Configured protected paths and secret-exfiltration patterns are hard-blocked.
- Configured risky actions require confirmation.
- Security and antivirus windows may be inspected read-only; input requires exact-phrase confirmation by default.
- Set `COMPUTER_CUSTOM_POLICY` to override the default policy config (both providers).
- Audit entries redact common secret keys and token-like values.

## Provider Notes

### Codex

Before first use in a conversation, load the wrapper through the Node REPL JavaScript tool:

```js
if (!globalThis.sky) {
  const { setupComputerCustomRuntime } = await import("<plugin root>/scripts/computer-custom-client.mjs");
  await setupComputerCustomRuntime({ globals: globalThis });
}
globalThis.apps = await sky.list_apps();
nodeRepl.write(JSON.stringify(apps, null, 2));
```

- The official bundled Computer Use plugin must be installed locally.
- This plugin locates `computer-use-client.mjs` at runtime and does not bundle OpenAI runtime files.
- Set `COMPUTER_CUSTOM_OFFICIAL_CLIENT` to an explicit `computer-use-client.mjs` path only for local debugging.
- Risky actions require action-time exact phrase confirmation (`I UNDERSTAND`).
- Audit entries live in `globalThis.computerCustomAudit`.
- When confirmation UI is unavailable, first attempt records a pending action and stops before input. Ask user for exact phrase `I UNDERSTAND`; only after user provides it, call `computerCustomAuthorizePending("I UNDERSTAND")` and retry unchanged action. Authorization is one-shot and expires after 60 seconds.
- Never synthesize confirmation phrase or authorize action without user providing it at action time.

### Claude Code

No setup step. A `PreToolUse` hook (`hooks/claude-hooks.json` → `scripts/computer-use-guard.mjs`) intercepts every `mcp__computer-use__*` tool call automatically and reuses the same `scripts/policy.mjs` classifier Codex uses.

- Blocked actions are denied outright; the matched rule is shown to Claude as the deny reason.
- Risky actions surface as a normal Claude Code permission prompt (`ask`) instead of a typed confirmation phrase.
- Audit entries are appended to `${CLAUDE_PLUGIN_DATA}/audit.jsonl`, capped at the configured `audit.maxEntries`.
- This policy layer supplements, not replaces, Claude Code's own Computer Use access tiers (browsers=read, terminals/IDEs=click, everything else=full) and the `request_access` gate — expect some actions to be gated twice, by design.

## Usage Rules

- Start by listing apps, then select a returned app/window before acting.
- On Codex, use the returned `sky` API exactly like Computer Use after setup.
- If a policy error blocks an action, report the exact method and reason.
