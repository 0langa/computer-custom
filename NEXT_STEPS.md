# Computer Custom — Current Status

_Last verified: 2026-08-05_

## Current source state

- The latest released source tag is `v0.1.5`. Check local and remote branch
  heads live before release work.
- `package.json` is the version source of truth. `npm run build` compiles `src/*.mts`
  into ignored `build/` files and regenerates the tracked plugin at
  `dist/computer-custom`.
- The plugin wraps the official Computer Use runtime with allow, block, and
  exact-phrase confirmation gates. The wrapper cannot override host policy,
  Windows integrity boundaries, or UAC secure desktop.

## Verification commands

| Command | Verifies |
| --- | --- |
| `npm ci` | Locked development dependencies |
| `npm test` | Build plus 22 Node regression tests |
| `npm run scan:public` | No bundled upstream/private runtime files in the public output |

`.github/workflows/ci.yml` runs those three commands on Windows for every push
and pull request.

## Maintenance boundaries

- Do not edit `dist/` by hand; change source or overlay files, then rebuild.
- `scripts/sync-upstream.ps1` may inspect the local official plugin and updates
  only its tracked hash manifest. Run it only when intentionally reconciling an
  upstream runtime change.
- Unit tests cover the wrapper and policy. A real `sky` smoke remains a manual,
  authorized check after a runtime or upstream integration change.

## Next action

For a source change, run the verification commands above before committing.
Do not create a release, tag, or marketplace update solely from this roadmap;
those are separate delivery decisions.
