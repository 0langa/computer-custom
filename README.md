# Computer Custom

Computer Custom is a Codex plugin wrapper around the locally installed OpenAI Computer Use runtime. It adds a configurable policy layer for technical users while keeping the official bundled plugin files out of this repository.

## What Is Included

- TypeScript policy wrapper for `sky` calls.
- Public-safe Codex plugin output under `dist/computer-custom`.
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

After marketplace integration:

```powershell
codex plugin add computer-custom@0langas-plugins
```

## Privacy

Audit entries are local process memory only by default and redact common secret keys and token-like values.

## Terms

Use this plugin only for authorized local automation. Official OpenAI runtime restrictions still apply where enforced by the installed runtime.
