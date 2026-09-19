#!/usr/bin/env node
/**
 * Computer Custom MCP server.
 *
 * One server, spoken to by both Claude Code and Codex over stdio. It owns the
 * tools, the policy decisions, the confirmations and the audit trail, and it
 * delegates every touch of the real machine to the native helper.
 *
 * Nothing here depends on a runtime shipped by either provider.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AuditLog } from "./audit.mjs";
import { loadServerConfig } from "./config.mjs";
import { HelperProcess } from "./helper-process.mjs";
import { Overlay } from "./overlay.mjs";
import { type SessionState, registerTools } from "./tools.mjs";

const SERVER_INSTRUCTIONS = `Controls this Windows machine: screen, mouse, keyboard, windows.

Workflow that works:
1. status, once, to learn what this helper can reach.
2. list_windows to choose a target, then focus_window.
3. ui_tree to see the real controls. Prefer it over screenshot.
4. Act with invoke_element where you can, click and type where you cannot.
5. Observe again after every action. Never reuse coordinates or element ids
   from an earlier look; windows move and trees are rebuilt.

Limits that are real, not policy:
- Elevated windows need an elevated helper. You will see UIPI_BLOCKED.
- The UAC consent prompt depends on the machine. Check status:
  - uacPromptOnSecureDesktop true: it is unreachable by anything. On
    SECURE_DESKTOP, stop and ask the user to answer it.
  - false, with uiAccess true: input does reach it. ui_tree still cannot read
    it, so screenshot the prompt and click by coordinates. Answering one always
    asks you for confirmation first, and that is deliberate.

Some actions are gated. When one is, relay the request to the user and use the
phrase they give you. Never invent a confirmation phrase.

The user can see a coloured border while you work, and can stop you instantly
with Ctrl+Alt+Shift+Esc. If a call reports the session was halted, stop: do not
retry, do not work around it, tell them and wait.`;

async function main(): Promise<void> {
  const config = loadServerConfig();
  const audit = new AuditLog(config.policy, config.auditPath);
  const helper = new HelperProcess();
  const session: SessionState = { halted: false };

  // The stop key has to mean something immediately, so it kills the helper
  // rather than asking it to finish. Whatever was mid-flight fails, which is
  // the correct outcome for a panic button.
  const overlay = new Overlay({
    onPanic: () => {
      session.halted = true;
      session.reason = "The user pressed the stop key (Ctrl+Alt+Shift+Esc) and halted this session.";
      helper.stop();
      audit.append({
        tool: "panic",
        decision: "denied",
        reason: "User pressed the stop hotkey",
        args: {},
      });
    },
  });

  const mcp = new McpServer(
    { name: "computer-custom", version: "0.2.0" },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  );

  registerTools({ mcp, helper, policy: config.policy, audit, overlay, session });

  const shutdown = () => {
    overlay.stop();
    helper.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  // The helper outlives its parent unless it is killed explicitly, and an
  // orphan holding the input queue is the last thing anyone wants.
  process.on("exit", () => {
    overlay.stop();
    helper.stop();
  });

  await mcp.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  // stdout carries the protocol, so diagnostics must go to stderr.
  process.stderr.write(`computer-custom failed to start: ${(error as Error).message}\n`);
  process.exit(1);
});
