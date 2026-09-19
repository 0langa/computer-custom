import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { it } from "node:test";

it("starts Windows PowerShell without inherited PowerShell 7 module paths", async () => {
  let windowsPowerShellEnvironment;
  try {
    ({ windowsPowerShellEnvironment } = await import("../scripts/windows-powershell.mjs"));
  } catch {
    // The first TDD run intentionally reaches this branch before the helper exists.
  }

  assert.equal(typeof windowsPowerShellEnvironment, "function");

  const poisoned = {
    ...process.env,
    PSModulePath: [
      path.join(process.env.ProgramFiles ?? "C:\\Program Files", "PowerShell", "7", "Modules"),
      path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "Modules"),
    ].join(path.delimiter),
  };
  const clean = windowsPowerShellEnvironment(poisoned);

  assert.equal(
    Object.keys(clean).some((name) => name.toLowerCase() === "psmodulepath"),
    false,
  );

  const result = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Import-Module Microsoft.PowerShell.Security -ErrorAction Stop; " +
        "if (Get-Command Get-AuthenticodeSignature -ErrorAction Stop) { 'ready' }",
    ],
    { encoding: "utf8", env: clean, windowsHide: true },
  ).trim();

  assert.equal(result, "ready");
});
