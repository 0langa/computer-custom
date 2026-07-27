# Computer Custom

Computer Custom runs official Computer Use with custom skill instructions and configurable policy gates. It keeps official bundled runtime files out of this repository.

## What Is Included

- TypeScript policy wrapper for Codex `sky` calls.
- Claude Code `PreToolUse` guard using same policy classifier.
- Public-safe multi-provider plugin output under `dist/computer-custom`.
- Local upstream sync script that stores hashes and an ignored local snapshot.
- Default policy config for protected paths, hard blocks, confirmations, and redacted audit entries.

## What Is Not Included

This repository does not redistribute OpenAI bundled plugin files or assets. The installed Codex environment must already include the official Computer Use plugin.

## Development

```powershell
npm install
npm run sync:upstream
npm run build
npm test
npm run scan:public
```

## Install From Marketplace

```powershell
codex plugin add computer-custom@0langas-plugins
```

Restart Codex after install or update so plugin cache reloads.

## Codex Confirmation Flow

Read-only inspection passes without confirmation. Destructive, publishing, administrative, installer, and security-tool input requires exact phrase `I UNDERSTAND`. Terminal automation and secret exfiltration remain hard-blocked by default.

Current Codex runtime lacks inline elicitation. First risky call stops before input and records pending action. Ask user for exact phrase; after user supplies it, run:

```js
computerCustomAuthorizePending("I UNDERSTAND")
```

Retry unchanged action within 60 seconds. Authorization works once and cannot approve different action. Never synthesize phrase for user.

Security-setting requests now reach exact confirmation instead of being rejected by custom policy. Provider/runtime restrictions still apply after custom confirmation.

## Runtime Boundary

Computer Custom can change its own instructions and policy. It cannot override host policy, official runtime enforcement, Windows process integrity, or secure desktop. In particular, normal Computer Use cannot target UAC prompts shown on secure desktop; user must complete those prompts manually.

If official Computer Use initialized `sky` earlier in a conversation, custom setup must still run. Check `globalThis.computerCustomRuntime?.wrapped`, not only `globalThis.sky`. Skill bootstrap handles this and requires reading live official `guidance` and `confirmations` documents before control.

## Privacy

Audit entries are local process memory only by default and redact common secret keys and token-like values.

## Terms

Use this plugin only for authorized local automation. Provider/runtime restrictions still apply where enforced.
