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
import { DesktopSession } from "./desktop-session.mjs";
import { type SessionState, registerTools } from "./tools.mjs";

const SERVER_INSTRUCTIONS = `Use Computer Custom when explicitly selected or when its prepared desktop batches, signed UIAccess helper, or saved local flows are needed. Prefer bundled Computer for ordinary computer tasks when it is available. This plugin does not wrap or replace bundled Computer.

Read status once, select a target from list_windows, and use observe without focusing. Prepare known actions together with prepare_batch, using observed target identities and window-relative coordinates. Five actions queue automatically; flush:true queues fewer, flush:false defers a known script. Single flushed actions execute immediately. Multiple actions get a five-second notice with Snooze/Cancel and execute automatically for at most ten seconds. Use live invoke_element selectors and wait_for for navigation dependencies. wait_batch returns progress or a shared resumeAt on Snooze. Never replay completed steps. Observe when the UI changes or a dependency needs its result, not between every predetermined step.

Legacy click/key/type/focus tools append to the same queue. They report queued progress, not completed effects. Observations flush pending actions; call flush_batch at task completion. Saved flows flush before observations, sleeps and completion. Input is held only during native execution. block suppresses physical input; ignore leaves user input enabled. Ctrl+Alt+Del releases Windows BlockInput; the overlay hotkey may not be received while blocking.

Host/model authorization remains authoritative. Carry already-authorized work through matching admin consent without another plugin confirmation by default. Confirm the prompt corresponds to the intended action. SECURE_DESKTOP means this helper cannot access that desktop: ask the user to answer it. Never change UAC settings automatically. UIAccess/integrity and actual errors determine reachable windows. Explicit local policy overrides can still request confirmation; relay those without inventing phrases. HALTED means the user stopped input: do not retry.`;

async function main(): Promise<void> {
  const config = loadServerConfig();
  const audit = new AuditLog(config.policy, config.auditPath);
  const helper = new DesktopSession();
  const session: SessionState = { halted: false };

  const mcp = new McpServer(
    { name: "computer-custom", version: "0.3.0" },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  );

  registerTools({ mcp, helper, desktop:helper,policy: config.policy, audit, session });

  const shutdown = () => {
    helper.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  // The helper outlives its parent unless it is killed explicitly, and an
  // orphan holding the input queue is the last thing anyone wants.
  process.on("exit", () => {
    helper.stop();
  });

  await mcp.connect(new StdioServerTransport());
  process.stdin.once("end",shutdown);
}

main().catch((error: unknown) => {
  // stdout carries the protocol, so diagnostics must go to stderr.
  process.stderr.write(`computer-custom failed to start: ${(error as Error).message}\n`);
  process.exit(1);
});
