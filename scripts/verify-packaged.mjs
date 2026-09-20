#!/usr/bin/env node
/**
 * Proves the PACKAGED plugin works, by being a real MCP client to it.
 *
 * The unit tests call the server's code in process. This does not: it spawns
 * the packaged server exactly as Claude Code and Codex do, over stdio, with the
 * working directory set to C:\ so nothing can be resolved out of the repo's
 * node_modules by accident. What passes here is what the user actually gets.
 *
 * It also exercises the three confirmation routes, because a gate that is only
 * unit tested is a gate nobody has watched refuse anything:
 *   - the user declines            -> the file must still be there
 *   - the phrase is wrong          -> the file must still be there
 *   - the phrase is exact          -> it acts, and the audit records it
 * Plus a hard block, which must refuse without asking anyone.
 *
 *   node scripts/verify-packaged.mjs                 the freshly built dist
 *   node scripts/verify-packaged.mjs <plugin-root>   an installed copy
 *
 * Runs the helper non-elevated, so it never raises a UAC prompt.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const ROOT = path.resolve(process.argv[2] ?? "dist/computer-custom");
if (!fs.existsSync(path.join(ROOT, "server", "index.mjs"))) {
  console.error(`Not a packaged plugin: ${ROOT}\nRun npm run package first, or pass a plugin root.`);
  process.exit(1);
}
console.log(`Plugin root: ${ROOT}`);
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`  ${ok ? "+" : "-"} ${name.padEnd(46)} ${detail ?? ""}`);
}

const marker = path.join(os.tmpdir(), `cc-e2e-${Date.now()}.txt`);
fs.writeFileSync(marker, "delete me");

const elicitations = [];
let answer = { action: "decline" };

const client = new Client(
  { name: "cc-e2e", version: "1.0.0" },
  { capabilities: { elicitation: {} } },
);
client.setRequestHandler(ElicitRequestSchema, async (request) => {
  elicitations.push(request.params);
  return answer;
});

const transport = new StdioClientTransport({
  command: "node",
  args: [path.join(ROOT, "server", "index.mjs")],
  cwd: "C:\\",
  env: {
    ...process.env,
    COMPUTER_CUSTOM_POLICY: path.join(ROOT, "config", "default-policy.json"),
    COMPUTER_CUSTOM_HELPER: path.join(ROOT, "helper", "computer-custom-helper.exe"),
    COMPUTER_CUSTOM_FLOWS: path.join(ROOT, "flows"),
    COMPUTER_CUSTOM_ELEVATED: "0", // non-elevated: no UAC noise during the test
    COMPUTER_CUSTOM_OVERLAY: "0",
  },
});

await client.connect(transport);

try {
  console.log("\nPackaged server, driven from C:\\ as a real MCP client");

  const { tools } = await client.listTools();
  check("tools advertised", tools.length === 24, `${tools.length} tools`);

  const status = JSON.parse((await client.callTool({ name: "status", arguments: {} })).content[0].text);
  check("status answers over the protocol", status.protocol === 1, `power=${status.power} uiAccess=${status.uiAccess}`);

  const windows = JSON.parse((await client.callTool({ name: "list_windows", arguments: {} })).content[0].text);
  check("read-only op needs no gate", Array.isArray(windows) && windows.length > 0, `${windows.length} windows`);

  // --- the gate must fire, and refusal must leave the file alone -----------
  answer = { action: "decline" };
  elicitations.length = 0;
  const refused = await client.callTool({ name: "fs_delete", arguments: { path: marker } });
  check("fs_delete asked before acting", elicitations.length === 1, elicitations[0]?.message?.slice(0, 60) ?? "no elicitation");
  check("refusal is reported as an error", refused.isError === true, refused.content[0].text.slice(0, 60));
  check("refused delete did NOT touch the file", fs.existsSync(marker), marker);

  // --- a hard block must never even ask ------------------------------------
  elicitations.length = 0;
  const blocked = await client.callTool({ name: "run_shell", arguments: { command: "format the drive D:" } });
  check("hard block refuses", blocked.isError === true, blocked.content[0].text.slice(0, 60));
  check("hard block never asks", elicitations.length === 0, `${elicitations.length} elicitations`);

  // --- a wrong phrase must be rejected, not waved through ------------------
  answer = { action: "accept", content: { phrase: "i understand" } };
  elicitations.length = 0;
  const wrong = await client.callTool({ name: "fs_delete", arguments: { path: marker } });
  check("wrong phrase is rejected", wrong.isError === true, wrong.content[0].text.slice(0, 55));
  check("wrong phrase did NOT delete", fs.existsSync(marker), "file still there");

  // --- the phrase carried in the call itself (the no-elicitation route) ----
  elicitations.length = 0;
  const carried = await client.callTool({
    name: "fs_delete",
    arguments: { path: marker, confirm: "I UNDERSTAND" },
  });
  check("a carried phrase needs no prompt", elicitations.length === 0, "0 elicitations");
  check("carried phrase succeeded", carried.isError !== true, carried.content[0].text.slice(0, 55));
  check("file is gone", !fs.existsSync(marker), marker);

  // --- the audit must have recorded all of it ------------------------------
  const entries = JSON.parse((await client.callTool({ name: "audit", arguments: { limit: 50 } })).content[0].text);
  const decisions = entries.map((e) => e.decision ?? e.action);
  check("audit recorded the blocked call", decisions.includes("block"), `${entries.length} entries`);
  check("audit recorded a confirmation", decisions.includes("confirm"), decisions.join(","));
} finally {
  await client.close();
  if (fs.existsSync(marker)) fs.rmSync(marker);
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length} FAILED: ${failed.map((r) => r.name).join(", ")}` : "\nAll packaged-plugin checks passed.");
process.exit(failed.length ? 1 : 0);
