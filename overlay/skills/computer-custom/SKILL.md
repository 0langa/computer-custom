---
name: computer-custom
description: Policy-controlled Windows Computer Use wrapper for technical Codex users
---

# Computer Custom

Use this skill to automate Microsoft Windows apps through the locally installed OpenAI Computer Use runtime with an added configurable policy layer.

Before first use in a conversation, load the wrapper through the Node REPL JavaScript tool:

```js
if (!globalThis.sky) {
  const { setupComputerCustomRuntime } = await import("<plugin root>/scripts/computer-custom-client.mjs");
  await setupComputerCustomRuntime({ globals: globalThis });
}
globalThis.apps = await sky.list_apps();
nodeRepl.write(JSON.stringify(apps, null, 2));
```

## Runtime

- The official bundled Computer Use plugin must be installed locally.
- This plugin locates `computer-use-client.mjs` at runtime and does not bundle OpenAI runtime files.
- Set `COMPUTER_CUSTOM_OFFICIAL_CLIENT` to an explicit `computer-use-client.mjs` path only for local debugging.
- Set `COMPUTER_CUSTOM_POLICY` to override the default policy config.

## Policy

- Read-only discovery calls normally pass through.
- Configured protected paths and secret-exfiltration patterns are hard-blocked.
- Configured risky actions require action-time exact phrase confirmation.
- Audit entries live in `globalThis.computerCustomAudit` and redact common secret keys and token-like values.

## Usage Rules

- Start by listing apps, then select a returned app/window before acting.
- Use the returned `sky` API exactly like Computer Use after setup.
- If a policy error blocks an action, report the exact method and reason.
- If confirmation UI is unavailable, stop and report that Computer Custom could not confirm the risky action.
