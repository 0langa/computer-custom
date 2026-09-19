# Computer Custom — Self-Contained Rebuild

_Design notes. Draft. 2026-09-19._

## 0. Decisions locked (2026-09-19)

You picked. Here is what we build.

- **"No 3rd party" means**: no OpenAI/Claude bundled runtime, no cloud server.
  It does **not** limit language or libraries. So we use whatever fits best.
- **Input engine (Fork A)**: one **owned native helper** (C#). It sends input,
  takes screenshots, reads the UI tree. It is also the signed component below.
  We do not use nut.js. Reason: the signing path (Fork C) needs the input to
  come from **our own signed .exe**, so the helper must be native anyway. One
  component, not two.
- **Elevation (Fork B)**: **scheduled-task helper now.** One-time setup. The
  helper runs at high power. No prompt each run.
- **UAC (Fork C)**: **free signing, so we do it.** But read section 6 — signing
  is free **and** it does not, by itself, let the agent click the UAC box for an
  admin account. There is a last-mile catch. It changes nothing about doing the
  signing; it changes what you expect from it.

### The one correction you need

You said "signing is most future safe, do it unless it costs money."

- **Good news: signing is free** for your own PC. You make a self-signed
  certificate, trust it on your machine only, and sign the helper. No paying
  Microsoft or any certificate seller. Tools like AutoHotkey do exactly this.
- **The catch: signing (uiAccess) still cannot click the real UAC box** when you
  are an **admin** user and the secure desktop is on. Microsoft's own rule:
  a uiAccess app reaches *elevated app windows*, but **not** system-level UI like
  the UAC consent box on the secure desktop. Signing gets the agent up to the
  UAC box, not through it.
- **So we do both, and they stack**: (1) sign the helper (free) → agent drives
  installers/regedit/Task Manager cleanly, without running your whole client as
  admin. (2) To click the UAC box itself, you still need the **reversible**
  secure-desktop setting from section 6, turned on only when you want a fully
  hands-off install. Default stays: you click the UAC box by hand.

## 1. The goal in plain words

You own this PC. You want an agent to use it like you do.
Mouse, keyboard, screen, terminal, files. After you say yes.

Today the plugin is a thin **policy wrapper**. It sits on top of OpenAI's
Computer Use runtime (`@oai/sky`). So it only works in Codex. And it needs the
official plugin installed first. That is the "third party" you want gone.

The rebuild goal: the plugin **owns the runtime**. It sends the input itself.
It works in Claude Code and Codex. It needs no official Computer Use plugin.

Note on words: "runtime" = the code that actually moves the mouse and takes the
screenshot. Right now that code is OpenAI's. After the rebuild it is yours.

---

## 2. What is possible on Windows (the rundown)

There are **levels**. Each level needs a different power. This is Windows, not a
plugin choice. Higher level = more setup.

"Integrity level" (IL) below = how much Windows trusts a process. Normal apps run
at **medium**. Admin apps run at **high**. Windows itself runs at **system**.
A process can only send input to apps at its own level or lower.

### Level 0 — Look (always works)

- Take a screenshot.
- List open windows and apps.
- Read the accessibility tree (the text and buttons Windows exposes for screen
  readers). Better than pixels because you get real element names.

No special power needed. Safe. Read-only.

### Level 1 — Act on normal apps (works out of the box)

- Move mouse, click, drag, scroll.
- Type text, press keys (Ctrl+S, Enter…).
- Focus a window.

Works at medium IL. This covers most daily apps: browsers, editors, Explorer,
chat apps, most installers **after** they open.

The right API is `SendInput` (injects into the real input stream). The old
`robotjs` used `SetCursorPos`, which some apps and games ignore. The rebuild must
use `SendInput`.

### Level 2 — Act on admin apps (needs the agent to run elevated)

Some app windows run at **high** IL (Task Manager, regedit, an installer that
already elevated). A medium agent cannot click them. Windows blocks it (this
block is called **UIPI**).

Fix: run the input part of the agent at **high** IL too. Then it can click those
windows. See section 5.

### Level 3 — The UAC prompt itself (special case)

This is your #1 pain. The "Do you want to allow this app to make changes?" box.

That box is drawn on the **secure desktop**. This is a separate screen that only
Windows can touch. No app — not even a high-IL app — can click it with normal
input. That is the whole point of it, by Microsoft's design.

So there is **no code trick** inside the plugin that reaches it while the secure
desktop is on, and signing alone does not change that. Two things together do:
the signed `uiAccess` helper **and** the secure desktop turned off. That
combination was measured working — the agent clicked a real consent prompt and
elevation was granted. Section 6 has the detail, including what it costs.

### Level 4 — Terminal and files (do it directly, not by typing)

You want terminal. The old plugin **blocks** cmd/powershell. That was a choice,
not a wall.

Better than typing into a terminal window with a fake keyboard: give the agent a
real **"run command"** tool. It runs the command as a child process and returns
the output. Same for files: real read/write/delete tools. Faster, cleaner, and
the output comes back as text the agent can read.

This is how tools like Desktop Commander work. We copy the good part and keep the
gate.

### What is truly impossible (be honest)

- Clicking the UAC box **without** the one setting change in section 6.
- Touching the login screen / lock screen (system IL, secure desktop).
- Beating a CAPTCHA or bot check. Not our job, and against the safety rules.

Everything else you can do by hand, the agent can do — after your yes.

---

## 3. Target architecture

One idea: **one MCP server. Two clients. No third party.**

MCP = Model Context Protocol. The shared "language" both Claude Code and Codex
speak to tools. If our runtime is an MCP server, both clients use the same one.

```
        ┌─────────────────┐        ┌─────────────────┐
        │   Claude Code   │        │      Codex      │
        │  (MCP client)   │        │  (MCP client)   │
        └────────┬────────┘        └────────┬────────┘
                 │  MCP (stdio)             │  MCP (stdio)
                 └───────────┬──────────────┘
                             ▼
              ┌──────────────────────────────┐
              │   computer-custom MCP server  │   ← we own all of this
              │                               │
              │  ┌─────────────────────────┐  │
              │  │  Tool layer             │  │  screenshot, click, type,
              │  │  (the MCP tools)        │  │  key, scroll, focus_window,
              │  └───────────┬─────────────┘  │  run_shell, fs_*, ui_tree,
              │              ▼                 │  run_flow, wait, clipboard
              │  ┌─────────────────────────┐  │
              │  │  Policy engine          │  │  ← reuse today's policy.mts
              │  │  allow / confirm / block│  │     (already provider-neutral)
              │  └───────────┬─────────────┘  │
              │              ▼                 │
              │  ┌─────────────────────────┐  │
              │  │  Confirm + Audit        │  │  MCP elicitation for the
              │  │                         │  │  "yes" prompt; audit.jsonl
              │  └───────────┬─────────────┘  │
              │              ▼                 │
              │  ┌─────────────────────────┐  │
              │  │  Input / screen layer   │  │  ← the new runtime
              │  │  (SendInput, capture,   │  │     (section 4)
              │  │   UI Automation)        │  │
              │  └───────────┬─────────────┘  │
              └──────────────┼────────────────┘
                             ▼
                 ┌───────────────────────┐
                 │  Elevated helper      │  optional, for high-IL apps
                 │  (high IL, section 5) │  and (with setup) the UAC box
                 └───────────────────────┘
```

### What each piece does

- **Tool layer** — the MCP tools the agent calls. This replaces `@oai/sky`.
- **Policy engine** — your existing `src/policy.mts`. It already takes a method
  name + args and returns allow / confirm / block. It does not care which client
  called. We keep it almost as-is. This is the best part of the current repo.
- **Confirm** — MCP now has **elicitation**: the server can pause and ask the
  user for input mid-call. This fixes the old Codex pain ("no inline
  confirmation"). For any client without elicitation, we keep the old
  pending-action + `I UNDERSTAND` fallback.
- **Audit** — keep the redacted `audit.jsonl` you already have.
- **Input / screen layer** — the new runtime. Section 4 picks it.
- **Elevated helper** — a small high-IL process for level-2 and level-3 work.
  Section 5.

### How each client wires up

- **Claude Code**: the plugin ships the MCP server in its manifest
  (`mcpServers` / `.mcp.json`). The old `PreToolUse` hook can stay as a **second
  gate** (belt and suspenders) or be dropped, because the server now gates
  itself. Recommend: keep it optional, off by default.
- **Codex**: the generated `.codex-plugin/plugin.json` points to a
  plugin-root-relative MCP configuration. Codex starts the same packaged server
  without a global `config.toml` entry. This **removes** the `@oai/sky` import
  and the "official plugin must be installed" rule. Fully self-contained.

Result: same tools, same policy, same audit, both clients. One codebase.

---

## 4. Fork A — RESOLVED: owned native helper (C#)

Kept for the record. Three options were on the table.

| Option | What it is | Third-party? | Speed | Work for you |
| --- | --- | --- | --- | --- |
| **nut.js** | Mature Node desktop-automation lib. Native, prebuilt binaries, SendInput, screen capture, window + UI element find. Apache-2.0. | Yes (one npm dep, vendored into your build) | Fast | Low |
| **Owned C#/.NET helper** | A small program you own. Calls SendInput, UI Automation, GDI screen capture. Built with the .NET SDK already on this PC. | No | Fast | High |
| **PowerShell + .NET at runtime** | Same Win32 calls, but compiled on the fly via `Add-Type`. No binary to ship. | No (uses OS only) | Medium | Medium |

Notes:
- "Self-contained" can mean two things. (a) No official Codex runtime — **all
  three options give you this.** (b) Zero npm dependency at all — only the C# or
  PowerShell options give you this.
- nut.js caveat: check current license and package source before you lean on it.
  Some `@nut-tree` plugins have used a private registry in the past. The core is
  Apache-2.0.
- Whatever we pick, we hide it behind **one interface** (`InputBackend`). So you
  can start with one and swap later without touching the tools or policy.

**Decision: owned C#/.NET helper.** Not for ideology — you lifted the
third-party limit. The real driver is Fork C: a `uiAccess` app must be **your own
signed .exe**. You cannot sensibly hang that manifest on `node.exe`. Since we
must build a signed native helper anyway, that helper should also be the input
engine. One component, one thing to sign, no throwaway work.

nut.js is dropped from the plan. It would have been rewritten in phase 3.

C# over C++ because Win32 interop, UI Automation and screen capture are all
short code there, and the .NET SDK is already on this PC. The helper publishes
as a single self-contained .exe. The server↔helper pipe protocol is the seam —
the helper's insides can be swapped later without touching tools or policy.

---

## 5. Fork B — RESOLVED: scheduled-task helper now

To click high-IL windows (level 2), the input part must run at high IL.

| Option | How | Prompt each time? | Work |
| --- | --- | --- | --- |
| **Run client elevated** | Start Claude/Codex "as admin". Whole chain is high IL. | One, at start | None |
| **Elevated helper via scheduled task** | Register a task once, "run with highest privileges". Medium server triggers it; it does the clicking. | No (after one-time setup) | Medium |
| **Skip for v1** | Only normal apps. Add elevation later. | — | None |

**Decision: scheduled-task helper, built early.** You set it up once, knowingly.
After that, no prompt per run.

How it works:

1. A one-time `install-helper` step copies the helper to `%ProgramFiles%\...`,
   signs it (section 6), and registers a Windows scheduled task set to
   **"run with highest privileges"**.
2. The MCP server stays at **normal** power — it is started by Claude/Codex, and
   we do not want your whole client running as admin.
3. When a tool call needs admin reach, the server triggers the task. The helper
   comes up at **high** power and does the input.
4. Server and helper talk over a **local named pipe**. Nothing leaves your PC.

This gives you level 1 **and** level 2 (see section 2) without elevating Claude
or Codex themselves. That separation is the point.

---

## 6. Fork C — RESOLVED: sign it (free), and know the limit

### Part 1: signing is free. We do it.

Windows demands three things before it grants an app `uiAccess`:

1. The app is **signed**, by a certificate that the **local machine's Trusted
   Root store** trusts.
2. The app sits in a **secure folder** (`%ProgramFiles%` or
   `%WinDir%\System32`).
3. The app's manifest says `uiAccess="true"`.

Point 1 does **not** say "a certificate you bought". A **self-signed**
certificate that you add to your own machine's trusted root store satisfies it,
on that machine. This is a normal, documented, free path. AutoHotkey ships a
script that does exactly this — make cert, trust it locally, set the manifest,
sign the .exe. We do the same for our helper.

Cost: zero. So by your own rule, we sign.

What signing buys us: the helper can reach **elevated app windows** even though
the MCP server that started it is not elevated. Installer windows, regedit, Task
Manager. It is the correct, accessibility-sanctioned way to do this, and it does
not require running Claude or Codex as admin.

### Part 2: the limit signing does not remove on its own

`uiAccess` lets an app cross **up to elevated (high) app UI**. It does **not**
reach **system-level** UI. Microsoft states this plainly: none of the uiAccess
scenarios give access to UI running at system level.

The UAC consent box runs at **system level, on the secure desktop**. So:

> A signed `uiAccess` helper still **cannot click the UAC box** while the secure
> desktop is on.

There is a related Windows setting, "allow uiAccess apps to prompt for elevation
without using the secure desktop". It does **not** help you here — Microsoft
notes it does not change UAC behaviour **for administrators**, and you are an
admin on this PC.

**Measured correction.** An earlier draft of this document stopped here and said
the prompt was unreachable, full stop. That was too strong, and it was tested
rather than argued:

- `ui_tree` on a consent prompt returns **1 node and no buttons**. The prompt
  runs at system integrity, and `uiAccess` genuinely does not reach system UI
  for *reading*. That part of the claim held.
- A **coordinate click** is a different matter. With the secure desktop off, a
  click from the signed `uiAccess` helper landed on the consent prompt's
  affirmative button and the elevation was granted.

So the prompt must be driven **from a screenshot, by coordinates** — never by
element. And it takes both halves: the signing and the setting.

### Part 3: so what actually clicks the UAC box

Only this, for an admin account: turn **off** "switch to the secure desktop when
prompting for elevation". Then the UAC box is drawn on the normal desktop, and
the high-power helper can click it.

| Mode | Secure desktop | Who clicks the UAC box | When to use |
| --- | --- | --- | --- |
| **Default** | On | You, by hand | Every day |
| **Hands-off** | Off (you flip it) | The agent | A long install session |

Rules we hold to:

- Default ships as **On**. The agent drives everything up to the UAC box, then
  stops and asks you to tap it.
- The plugin **never flips this by itself**. We ship a script **you** run. It
  states the trade-off, and it flips back.
- Best practice: flip it on for the session, flip it back after. The helper can
  offer to restore it.

So your instinct was right — signing is free and worth doing — it just solves
levels 1–2, not level 3. Level 3 stays your explicit, reversible choice.

---

## 7. Policy changes

Keep the engine. Change the defaults to fit a **home PC**, not a work PC.

- **Terminal**: was hard-blocked. Change to **confirm** (via the `run_shell`
  tool with its own gate). You wanted this.
- **Files**: real `fs_read` / `fs_write` / `fs_delete` tools. Delete and
  overwrite = confirm. Protected roots stay configurable.
- **Installers, admin tools, security tools**: stay **confirm** (not block).
  Already true in 0.1.4+.
- **Keep as hard-block**: sending secrets/credentials out (exfiltration
  patterns). This is the one guard worth keeping even on a home PC. The model's
  own guardrails already stop the truly bad stuff; this is cheap insurance.
- Everything stays overridable by your `COMPUTER_CUSTOM_POLICY` config.

So: fewer walls, same gates, one guard kept.

---

## 8. Prewritten flows (you asked for this)

Add a **flows** feature. A flow is a saved list of steps in a file
(`flows/*.json` or `*.mjs`). Example: open app → wait → click "New" → type →
screenshot → check.

- New tool: `run_flow(name)` runs a saved flow.
- New tool: `list_flows()` shows what you have.
- Each step still passes through the policy engine. No flow skips a gate.
- Great for your repeat testing runs. Write once, replay by name.

---

## 9. Migration plan (phases)

- **Phase 0 — scaffold.** New folder layout. Define the server↔helper pipe
  protocol. Port `policy.mts` across unchanged. No behaviour change yet.
- **Phase 1 — helper + server, levels 0 and 1.** Build the C# helper at normal
  power: screenshot, list/focus windows, mouse, keyboard, scroll, UI tree. Build
  the MCP server: tools, policy, audit, elicitation. Wire Claude Code **and**
  Codex. **`@oai/sky` is gone from here on.** This is the first usable build.
- **Phase 2 — shell, files, flows.** `run_shell`, `fs_read/write/delete`,
  `run_flow`, `list_flows`. Terminal moves from blocked to gated.
- **Phase 3 — signing + elevation (level 2).** `install-helper` step: copy to
  Program Files, make and trust a self-signed cert, set the `uiAccess` manifest,
  sign, register the scheduled task. Agent can now drive elevated windows.
- **Phase 4 — UAC opt-in (level 3).** The reversible secure-desktop script you
  run yourself, plus docs and a restore path.

Each phase ships something usable. Tests and CI ride along, as today.


---

## 10. What we keep from the current repo

- `src/policy.mts` — the classifier. Barely touched.
- The audit log + secret redaction.
- The allow / confirm / block tiers and exact-phrase idea.
- The build/dist split and public-safety scan.
- The Claude `PreToolUse` guard — kept as an optional second gate.

What we drop: the hard dependency on `@oai/sky` and the official Computer Use
plugin. That is the whole point.
