# Computer Custom

Windows computer control for Claude Code and Codex, with policy gates you own.

It ships its own MCP server and a native helper. It does **not** need any
provider's bundled computer-use runtime, and it talks to nothing but this
machine.

## What it does

- Reads the screen: screenshots, window list, and the Windows accessibility
  tree with real control names and bounds.
- Drives the machine: mouse, keyboard, drag, scroll, clipboard, and direct
  invocation of accessibility elements.
- Runs commands and touches files directly: `run_shell` returns real output
  instead of pixels, and there are proper file read, write and delete tools.
- Replays saved **flows**: JavaScript files with real loops and conditions, for
  the sequences you run over and over.
- Gates what matters: read-only calls pass, risky ones ask, a short list is
  blocked outright. Every decision is recorded, with secrets redacted.

## Architecture

```
Claude Code ─┐
             ├─ MCP (stdio) ─► computer-custom server ─ named pipe ─► native helper
Codex ───────┘                 tools, policy, audit,                  SendInput,
                               confirmations                          UI Automation,
                                                                      screen capture
```

The server makes every decision and never touches the OS. The helper touches
the OS and never makes a decision. They are separate processes so the helper
can later run at a higher privilege than the client that started the server.

See [docs/REBUILD-DESIGN.md](docs/REBUILD-DESIGN.md) for the design and
[docs/PROTOCOL.md](docs/PROTOCOL.md) for the wire contract.

## Install

```powershell
codex plugin add computer-custom@0langas-plugins
```

Restart the client after install or update so the plugin cache reloads.

For Codex, add the server to `config.toml`:

```toml
[mcp_servers.computer-custom]
command = "node"
args = ["<plugin root>/server/index.mjs"]

[mcp_servers.computer-custom.env]
COMPUTER_CUSTOM_POLICY = "<plugin root>/config/default-policy.json"
COMPUTER_CUSTOM_HELPER = "<plugin root>/helper/computer-custom-helper.exe"
```

Claude Code picks the server up from the plugin's `.mcp.json` automatically.

## Policy

Point `COMPUTER_CUSTOM_POLICY` at your own file to change any of this. Both
providers read the same one.

Defaults:

- Read-only tools pass with no gate.
- Input tools are classified together with the **focused application**, so a
  rule about installers, admin tools or security software can match what is
  actually being typed into. A click in an ordinary app stays ungated.
- Irreversible tools gate on their name alone, whatever their arguments say.
- Terminal access is **not** blocked. Destructive commands confirm; ordinary
  ones run.
- Drive formatting and credential exfiltration are hard-blocked. A hard block
  is not a prompt; only editing the policy lifts it.

Confirmation uses MCP elicitation where the client supports it. Where it does
not, the call is refused with instructions to get an exact phrase from the
user. The agent is told never to invent that phrase.

## Flows

A flow is a JavaScript file that exports a default async function. It receives a
context object with one method per tool, plus `args`, `log` and `sleep`.

```js
export const description = "Opens the editor and saves a file";

export default async function (cc) {
  const windows = await cc.list_windows();
  cc.log(`${windows.length} windows`);
  await cc.key({ keys: ["ctrl", "s"] });
  return { saved: true };
}
```

Run it with `run_flow`, list them with `list_flows`. Flows live in
`COMPUTER_CUSTOM_FLOWS`, which defaults to the plugin's own `flows/`. **Point it
at a directory of your own**, or a plugin update will take your flows with it.

Every tool call inside a flow passes the same policy gate as a direct call, so a
flow can be blocked or can stop to ask you, and each step lands in the audit.

**The JavaScript itself is not sandboxed.** A flow is your own code running in
the server process, with everything Node can do, exactly like a script you would
run yourself. Anyone who can write a file into the flows directory can run code
as you. Treat that directory like your own scripts folder.

## Driving elevated windows

By default the helper runs at your normal privilege, so windows belonging to
elevated programs — an installer after it appears, regedit, Task Manager —
return `UIPI_BLOCKED`.

To reach them, install the elevated helper. Read what it will do first:

```powershell
.\scripts\install-elevated-helper.ps1 -DryRun
```

Then, from an elevated PowerShell:

```powershell
.\scripts\install-elevated-helper.ps1
```

It creates a **self-signed certificate trusted on this machine only** (no
certificate authority, no cost), signs a build of the helper whose manifest
requests `uiAccess`, and installs it into Program Files. Admin rights are needed
once, for that. Nothing is registered to run in the background.

After that the plugin launches the helper itself through ShellExecute, which is
the only path that grants UIAccess — `CreateProcess` refuses a `uiAccess` binary
outright, so a scheduled task cannot do it either. **No UAC prompt appears**;
granting UIAccess to a signed binary in a protected folder is what the mechanism
is for.

Turn it on with `COMPUTER_CUSTOM_ELEVATED=1`, then check it:

```bash
npm run verify:elevation
```

It checks every prerequisite, starts the helper, and with `--focus` proves the
point by bringing a real elevated window to the front. Expect `power: high` and
`uiAccess: true`.

Undo everything with `.\scripts\install-elevated-helper.ps1 -Uninstall`.

If you ask for elevation without installing it, the plugin does **not** fail and
does **not** pretend: it starts the normal helper and `status` tells you what
happened and how to fix it.

Your client is never elevated. Only the helper is, which is the point of keeping
them in separate processes.

## The UAC prompt, and the one setting that changes it

By default Windows draws the UAC consent prompt on the **secure desktop**: a
separate desktop object no application can reach. That is why nothing can
automate a UAC prompt, at any privilege, signed or not.

Check what your machine actually does. This needs no admin rights and changes
nothing:

```powershell
.\scripts\uac-secure-desktop.ps1
```

`status` reports the same thing as `uacPromptOnSecureDesktop`, so the agent can
tell you the truth rather than guessing.

Turning the secure desktop off moves those prompts onto the ordinary desktop,
where the elevated helper can click them:

```powershell
.\scripts\uac-secure-desktop.ps1 -Disable -Minutes 20 -IUnderstand
```

**Understand what that costs.** It does not grant the capability to this
plugin. It grants it to *everything* running on the machine. The secure desktop
exists precisely so software cannot approve its own elevation prompts; with it
off, the gap between "runs as me" and "runs as administrator" is a click any
process can make. That is a real reduction in your machine's security.

Which is why the plugin never changes it, the script refuses without
`-IUnderstand`, and `-Minutes` schedules the restore so a forgotten setting
cannot leave you exposed. Put it back at any time with `-Enable`.

## Capability boundaries

Honest limits, enforced by Windows rather than by this plugin:

- The helper drives windows at its own privilege level or below. Elevated
  windows return `UIPI_BLOCKED` until the elevated helper above is installed.
- **While the secure desktop is on**, the UAC consent prompt is unreachable by
  anything, at any privilege, signed or not. Calls during a prompt return
  `SECURE_DESKTOP`.
- **With the secure desktop off and the signed `uiAccess` helper installed,
  input does reach it.** Measured, not assumed: a coordinate click on the
  consent prompt granted elevation. Both halves are required — neither the
  signing nor the setting achieves it alone.
  `ui_tree` still returns nothing useful for the prompt, because it runs at
  system integrity, so it has to be driven from a screenshot by coordinates.
  Answering a consent prompt always requires confirmation first.
- After a plugin update the installed elevated helper is still the old one: it
  is signed separately and nothing touches it automatically. `status` says so,
  rather than letting elevated sessions quietly run stale code.

## Development

```powershell
npm install
npm test
npm run scan:public
npm run package
```

- `npm test` compiles `src/*.mts` and runs the Node test suite.
- `npm run package` bundles the server and publishes the helper into
  `dist/computer-custom`.
- Building the helper needs the .NET SDK: `dotnet build helper/ComputerCustom.Helper`.
- Do not edit `dist/` by hand.

## Privacy

Nothing leaves this machine. The pipe between server and helper is local, its
ACL names only the current user, and the helper proves a per-session token
before the server will talk to it. Audit entries are local and redact common
secret keys and token-like values.

## Terms

Use this plugin only for automation you are authorised to perform on machines
you control. Provider and runtime restrictions still apply where enforced.
