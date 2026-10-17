#!/usr/bin/env node
/**
 * Checks whether the elevated helper is installed and actually working.
 *
 * Read-only by default: it inspects, starts a helper, and reports.
 *
 *   node scripts/verify-elevation.mjs            prerequisites + capability
 *   node scripts/verify-elevation.mjs --focus    also front an elevated window
 *   node scripts/verify-elevation.mjs --prove    also type into one
 *
 * Focus/tree access does not prove synthetic input delivery. The legacy --prove
 * option reports visual change only; owned fixture value/event readback is the
 * conclusive acceptance test. Input uses the prepared desktop queue.
 */

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HelperProcess,installedHelperPath } from "../build/server/helper-process.mjs";
import { windowsPowerShellEnvironment } from "./windows-powershell.mjs";
import {DesktopSession} from '../build/server/desktop-session.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installedExe = installedHelperPath();

const wantFocus = process.argv.includes("--focus");
const wantProof = process.argv.includes("--prove");
const results = [];

function check(name, ok, detail) {
  results.push({ name, ok, detail });
  const mark = ok === null ? "  ?" : ok ? "  +" : "  -";
  console.log(`${mark} ${name.padEnd(38)} ${detail}`);
}

function powershell(script) {
  return execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf8",
    env: windowsPowerShellEnvironment(),
    windowsHide: true,
  }).trim();
}

/**
 * Types a marker into a window and reports whether the window changed.
 *
 * Compares a screenshot before and after rather than reading the text back: a
 * console's pending input line is not reliably exposed through UI Automation,
 * and a failed READ must never be mistaken for failed INPUT. Measured — the UIA
 * readback reported "not typed" for input that had visibly landed on screen.
 *
 * Harmless: types a bare marker, never presses Enter, then clears the line.
 */
async function inputLands(helper, target, input) {
  const region = {
    x: target.x,
    y: target.y,
    width: Math.min(target.width, 900),
    height: Math.min(target.height, 300),
  };
  const digest = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  await input.call("focus_window", { handle: target.handle });
  await pause(800);

  // The capture is of screen coordinates, so anything covering the window would
  // be photographed instead of it. Without this guard an occluded target looks
  // exactly like refused input, which would be a false accusation.
  const foreground = (await helper.call("foreground_window")).result;
  if (foreground?.handle !== target.handle) {
    return null;
  }

  const before = digest((await helper.call("screenshot", region)).binary);

  try {
    await input.call("type_text", { target, text: `cc-probe-${Date.now()}` });
  } catch {
    return false;
  }

  await pause(900);
  const after = digest((await helper.call("screenshot", region)).binary);

  try {
    await input.call("key", { target, keys: ["escape"] });
  } catch {
    /* nothing was typed, so nothing to clear */
  }

  return before !== after;
}

console.log("\nPrerequisites");

// Installed, signed executable. There is deliberately no scheduled task: a
// task launches via CreateProcess, which cannot start a uiAccess binary.
const exeOk = fs.existsSync(installedExe);
check("helper installed in Program Files", exeOk, installedExe);

let signatureOk = false;
if (exeOk) {
  try {
    const status = powershell(`(Get-AuthenticodeSignature -FilePath '${installedExe}').Status`);
    signatureOk = status === "Valid";
    check("signature valid", signatureOk, status);
  } catch (error) {
    check("signature valid", false, error.message.split("\n")[0]);
  }
} else {
  check("signature valid", false, "skipped, nothing installed");
}

// 3. uiAccess in the installed binary's manifest.
if (exeOk) {
  const bytes = fs.readFileSync(installedExe);
  const hasUiAccess = bytes.includes(Buffer.from('uiAccess="true"', "utf8"));
  check("manifest requests uiAccess", hasUiAccess, hasUiAccess ? "present" : "missing");
} else {
  check("manifest requests uiAccess", false, "skipped, nothing installed");
}

// 4. Certificate trusted by the machine.
try {
  const count = powershell(
    "(Get-ChildItem Cert:\\LocalMachine\\Root | Where-Object { $_.Subject -eq 'CN=Computer Custom Helper' }).Count",
  );
  const trusted = Number(count) > 0;
  check("certificate in trusted root", trusted, trusted ? "found" : "not found");
} catch (error) {
  check("certificate in trusted root", null, error.message.split("\n")[0]);
}

if (!exeOk) {
  console.log(`
Not installed yet. From an ELEVATED PowerShell:

  cd ${repoRoot}
  .\\scripts\\install-elevated-helper.ps1 -DryRun    # read it first
  .\\scripts\\install-elevated-helper.ps1
`);
  process.exit(1);
}

// ---------------------------------------------------------------- live test

console.log("\nLive check");
process.env.COMPUTER_CUSTOM_ELEVATED = "1";
const helper = new HelperProcess();
const input = new DesktopSession();

try {
  const ping = (await helper.call("ping")).result;
  const start = helper.startInfo;

  check("started elevated", start?.actual === "elevated", `${start?.requested} -> ${start?.actual}`);
  if (start?.notice) {
    check("installed helper up to date", false, start.notice);
  }

  check("helper integrity", ping.power === "high", `${ping.power} (integrity: ${ping.integrity})`);
  check("uiAccess granted", ping.uiAccess === true, String(ping.uiAccess));
  check("secure desktop clear", ping.secureDesktopActive === false, String(ping.secureDesktopActive));

  // Not a pass/fail: it is the machine's configuration, and both values are
  // legitimate. It decides whether a UAC prompt can be reached at all.
  check(
    "UAC prompts on secure desktop",
    null,
    ping.uacPromptOnSecureDesktop === undefined
      ? "unknown (installed helper predates this check)"
      : ping.uacPromptOnSecureDesktop
        ? "yes — this helper cannot operate that desktop"
        : "NO — on the ordinary desktop, so a uiAccess helper can click it",
  );

  const windows = (await helper.call("list_windows")).result;
  // Our own helper is elevated too. Focusing your own window proves nothing
  // about crossing UIPI, so it must not count as evidence.
  const elevated = windows.filter(
    (w) =>
      (w.integrity === "high" || w.integrity === "system") &&
      !w.process.toLowerCase().includes("computer-custom-helper"),
  );
  check(
    "foreign elevated window present",
    elevated.length > 0 ? true : null,
    elevated.length > 0
      ? elevated.map((w) => w.process).join(", ")
      : "none open — start Task Manager or regedit, then re-run with --focus",
  );

  if (wantFocus && elevated.length > 0) {
    const target = elevated[0];
    try {
      await input.call("focus_window", { handle: target.handle });
      // Deliberately NOT reported as proof of crossing UIPI. Measured on this
      // machine: an unsigned medium-integrity helper focuses the same window
      // and reads the same tree. SetForegroundWindow follows foreground
      // activation rules and UI Automation reads are permitted; neither is
      // what UIPI restricts.
      check("focused an elevated window", true, `${target.process} (not a UIPI test)`);
    } catch (error) {
      check("focused an elevated window", false, `${error.code}: ${error.message}`);
    }
  }

  if (wantProof && elevated.length > 0) {
    const target = elevated[0];
    const landed = await inputLands(helper, target,input);
    check(
      "synthetic input reaches it",
      landed,
      landed === null
        ? `could not bring ${target.process} to the front — inconclusive, not a failure`
        : landed
          ? "the window changed after injection (visual evidence only)"
          : "no change — input did not arrive",
    );
  } else if (elevated.length > 0 && !wantProof) {
    console.log("    (add --prove to type into it and confirm the input arrives)");
  }

} finally {
  input.stop();
  helper.stop();
}

const failed = results.filter((r) => r.ok === false);
if (failed.length > 0) {
  console.log(`\n${failed.length} check(s) failed: ${failed.map((r) => r.name).join(", ")}`);
} else {
  console.log(
    "\nThe helper holds high integrity and UIAccess, which is what Windows requires" +
      "\nbefore synthetic input may reach a higher-integrity window. An unsigned helper" +
      "\ngets neither, so this is a real capability difference.",
  );
  const proof = results.find((r) => r.name === "synthetic input reaches it");
  if (proof?.ok === true) {
    console.log(
      "\nA visual change followed the probe. For conclusive input verification," +
        "\nuse the owned fixture's text/event readback; screenshot changes alone are inconclusive.",
    );
  } else {
    console.log(
      "\nFocusing a window and reading its tree are NOT restricted by UIPI, so they" +
        "\ncannot demonstrate it. Open a window from an app that genuinely requires" +
        "\nelevation, then re-run with --prove to type into it and confirm.",
    );
  }
}
console.log(
  "\nThis helper cannot operate the secure input desktop. For ordinary-desktop" +
    "\nconsent, carry task authorization and verify actual controls/capability." +
    "\nThis check does not change UAC policy.\n",
);
process.exit(failed.length === 0 ? 0 : 1);
