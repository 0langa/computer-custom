---
name: computer-custom
description: Use this skill when live-testing or automating Windows apps in Codex or Claude Code through official Computer Use with user-controlled policy gates.
---

# Computer Custom

Runs official Computer Use with custom instructions and policy gates. Same `sky` API, target-selection workflow, screenshots, accessibility state, and native helper. Custom layer classifies calls before official runtime receives them and records redacted audit entries.

Custom policy can be less or more restrictive than default policy. It cannot override Codex/Claude policy, official runtime restrictions, Windows integrity boundaries, secure desktop, or unavailable OS capability.

## Policy

- Read-only discovery calls normally pass through.
- Configured protected paths and secret-exfiltration patterns are hard-blocked.
- Configured risky actions require confirmation.
- Default policy hard-blocks terminal automation and secret exfiltration.
- Default policy confirms destructive, administrative, installer, security-tool, and external-side-effect input.
- Default policy does not block ordinary paths merely because they are under Windows or Program Files.
- Set `COMPUTER_CUSTOM_POLICY` to override the default policy config (both providers).
- Audit entries redact common secret keys and token-like values.

## Provider Notes

### Codex

Before first use in a conversation, load wrapper through Node REPL JavaScript. Do this even when `globalThis.sky` already exists; official Computer Use may have initialized it first.

```js
if (!globalThis.computerCustomRuntime?.wrapped) {
  const { setupComputerCustomRuntime } = await import("<plugin root>/scripts/computer-custom-client.mjs");
  await setupComputerCustomRuntime({ globals: globalThis });
}
globalThis.apps = await sky.list_apps();
nodeRepl.write(JSON.stringify(apps, null, 2));
```

Before controlling any Windows app, read live official guidance and confirmation policy:

```js
globalThis.computerCustomGuidance = await sky.documentation("guidance");
nodeRepl.write(computerCustomGuidance);
```

```js
globalThis.computerCustomConfirmations = await sky.documentation("confirmations");
nodeRepl.write(computerCustomConfirmations);
```

Read `await sky.documentation("api")` when method signatures or returned shapes are unclear.

- The official bundled Computer Use plugin must be installed locally.
- This plugin locates `computer-use-client.mjs` at runtime and does not bundle OpenAI runtime files.
- Never skip custom setup merely because `sky` exists. Check `computerCustomRuntime?.wrapped`.
- Do not initialize official Computer Use again after custom setup; that would replace policy wrapper.
- Set `COMPUTER_CUSTOM_OFFICIAL_CLIENT` to an explicit `computer-use-client.mjs` path only for local debugging.
- Risky actions require action-time exact phrase confirmation (`I UNDERSTAND`).
- Audit entries live in `globalThis.computerCustomAudit`.
- When confirmation UI is unavailable, first attempt records a pending action and stops before input. Ask user for exact phrase `I UNDERSTAND`; only after user provides it, call `computerCustomAuthorizePending("I UNDERSTAND")` and retry unchanged action. Authorization is one-shot and expires after 60 seconds.
- Never synthesize confirmation phrase or authorize action without user providing it at action time.
- Exact-phrase approval authorizes only identical pending call once. Reobserve instead of retrying if window, focus, or coordinates may have changed.
- If official runtime asks its own approval, honor that approval separately.

### Claude Code

No setup step. A `PreToolUse` hook (`hooks/claude-hooks.json` → `scripts/computer-use-guard.mjs`) intercepts every `mcp__computer-use__*` tool call automatically and reuses the same `scripts/policy.mjs` classifier Codex uses.

- Blocked actions are denied outright; the matched rule is shown to Claude as the deny reason.
- Risky actions surface as a normal Claude Code permission prompt (`ask`) instead of a typed confirmation phrase.
- Audit entries are appended to `${CLAUDE_PLUGIN_DATA}/audit.jsonl`, capped at the configured `audit.maxEntries`.
- This policy layer supplements, not replaces, Claude Code's own Computer Use access tiers (browsers=read, terminals/IDEs=click, everything else=full) and the `request_access` gate — expect some actions to be gated twice, by design.

## Usage Rules

- Start by listing apps, then select a returned app/window before acting.
- On Codex, use the returned `sky` API exactly like Computer Use after setup.
- Follow live `guidance` workflow: unique returned target, observe, one input, immediate refresh. Never reuse stale screenshot IDs, coordinates, or element indexes.
- If a policy error blocks an action, report the exact method and reason.
- Never claim custom instructions grant authority or capability that provider, runtime, or Windows does not expose. UAC secure-desktop prompts are not targetable through normal Computer Use. Ask user to complete those prompts manually.
