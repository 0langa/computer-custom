import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { it } from "node:test";

const DIST = path.resolve("dist/computer-custom");

it("registers the bundled MCP server in the Codex plugin manifest", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(DIST, ".codex-plugin", "plugin.json"), "utf8"),
  );

  assert.equal(manifest.mcpServers, "./.codex-mcp.json");

  const configPath = path.join(DIST, ".codex-mcp.json");
  assert.equal(fs.existsSync(configPath), true, "missing Codex MCP config");

  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.deepEqual(config.mcpServers["computer-custom"], {
    command: "node",
    args: ["./server/index.mjs"],
    cwd: "./",
    env: {
      COMPUTER_CUSTOM_POLICY: "./config/default-policy.json",
      COMPUTER_CUSTOM_HELPER: "./helper/computer-custom-helper.exe",
      COMPUTER_CUSTOM_FLOWS: "./flows",
    },
  });
});
