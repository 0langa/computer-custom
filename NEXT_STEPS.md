# Computer Custom — Current Status

_Last verified: 2026-09-19_

## Where the rebuild stands

Phases 0 to 3 of `docs/REBUILD-DESIGN.md` are done. The plugin runs its own MCP
server and native helper, serves 24 tools, and needs no provider computer-use
runtime.

Phase 3 is installed on this machine. Measured from a **non-elevated** session,
which is how the clients actually run:

- signed helper: `integrity: high`, `uiAccess: true`, **no UAC prompt**
- unsigned helper: `integrity: medium`, `uiAccess: false`

That is a real capability difference, and it is the precondition Windows sets
for input reaching a higher-integrity window.

**Confirmed end to end** against an elevated PowerShell 7 window: text typed by
the signed helper arrived, text typed by the unsigned one did not. That is UIPI
actually being crossed.

Set `COMPUTER_CUSTOM_ELEVATED=1` to use it. To re-check, open a window from an
app that genuinely requires elevation and run:

```powershell
npm run verify:elevation -- --prove
```

Only `--prove` demonstrates UIPI. Focusing a window and reading its tree are not
restricted by it, so they prove nothing — Task Manager is not a valid target on
this machine for that reason.

To reproduce elsewhere, from an elevated PowerShell:

```powershell
.\scripts\install-elevated-helper.ps1 -DryRun   # read it first
.\scripts\install-elevated-helper.ps1
```

| Phase | What | State |
| --- | --- | --- |
| 0 | Protocol, framing, handshake, policy port | Done |
| 1 | C# helper, MCP server, both clients wired | Done |
| 2 | `run_shell`, `fs_*`, saved flows | Done |
| 3 | Signing + uiAccess elevation (level 2) | Done, installed, confirmed end to end |
| 4 | UAC secure-desktop opt-in (level 3) | Done |

## Verification commands

| Command | Verifies |
| --- | --- |
| `npm ci` | Locked development dependencies |
| `npm test` | Build plus the Node regression suite (95 tests) |
| `npm run scan:public` | No machine paths or private runtime files in public output |
| `npm run package` | Bundled server plus published helper in `dist/computer-custom` |
| `dotnet build helper/ComputerCustom.Helper` | The native helper compiles |

`.github/workflows/ci.yml` runs the first three on Windows for every push.

## What is verified working

- Packaged plugin driven as a real MCP client from a directory with no
  `node_modules`: 18 tools, live window listing, capture and accessibility tree.
- The gate end to end: refusal when no prompt is possible, user decline, user
  allow, wrong phrase rejected, exact phrase accepted, each recorded in the
  audit with the target application.
- Hard blocks still fail closed.
- Shell, file and flow tools driven through the packaged server: real command
  output, write/read/delete round trip, delete refused on a wrong phrase, and a
  saved flow running with its logs and result returned.

## Known limits, by design

- Until the elevated helper is installed, the helper runs at medium integrity
  and elevated windows return `UIPI_BLOCKED`. The session falls back and says so
  rather than failing.
- A `uiAccess` binary can only be launched through ShellExecute. Never switch
  the elevated launch to `spawn`, a scheduled task, or `Start-Process
  -NoNewWindow`: all three use CreateProcess and are refused outright.
- The UAC consent prompt returns `SECURE_DESKTOP` and can never be automated.
  Phase 4 only makes the prompt appear somewhere reachable, and only if the
  user opts in.

## Maintenance boundaries

- Do not edit `dist/` by hand; change `src/` or `overlay/`, then rebuild.
- `npm run build` preserves `dist/computer-custom/helper`, which comes from
  `npm run publish:helper`. Run `npm run package` for a complete artifact.
- Release helper builds must keep `DebugType=none`; portable pdbs embed the
  build machine's paths into a publicly distributed binary.
