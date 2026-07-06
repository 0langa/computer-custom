import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPolicy, classifySkyCall, redactForAudit } from "./policy.mjs";

export const HOOK_TOOL_PREFIX = "mcp__computer-use__";

// Maps Claude Code's mcp__computer-use__* tool names onto the sky-API method
// names the shared policy.mjs classifier already knows how to gate.
export const TOOL_METHOD_MAP = {
  left_click: "click",
  double_click: "click",
  triple_click: "click",
  middle_click: "click",
  left_click_drag: "click",
  left_mouse_down: "click",
  left_mouse_up: "click",
  right_click: "perform_secondary_action",
  key: "press_key",
  hold_key: "press_key",
  type: "type_text",
  write_clipboard: "set_value",
};

export function resolveSkyMethod(toolName) {
  if (typeof toolName !== "string" || !toolName.startsWith(HOOK_TOOL_PREFIX)) {
    return null;
  }
  const suffix = toolName.slice(HOOK_TOOL_PREFIX.length);
  return TOOL_METHOD_MAP[suffix] ?? suffix;
}

export function appendAuditLine(dataDir, entry, maxEntries) {
  if (!dataDir) return;
  fs.mkdirSync(dataDir, { recursive: true });
  const auditPath = path.join(dataDir, "audit.jsonl");
  const lines = fs.existsSync(auditPath)
    ? fs.readFileSync(auditPath, "utf8").split("\n").filter(Boolean)
    : [];
  lines.push(JSON.stringify(entry));
  while (lines.length > maxEntries) {
    lines.shift();
  }
  fs.writeFileSync(auditPath, `${lines.join("\n")}\n`, "utf8");
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function emitDecision(hookSpecificOutput) {
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput })}\n`);
}

async function main() {
  const raw = await readStdin();
  const input = raw ? JSON.parse(raw) : {};
  const skyMethod = resolveSkyMethod(input.tool_name);
  if (!skyMethod) {
    process.exit(0);
    return;
  }

  const policyPath =
    process.env.COMPUTER_CUSTOM_POLICY ??
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "config", "default-policy.json");
  const policy = loadPolicy(policyPath);
  const toolInput = input.tool_input ?? {};
  const decision = classifySkyCall(skyMethod, [toolInput], policy);

  appendAuditLine(
    process.env.CLAUDE_PLUGIN_DATA,
    {
      at: new Date().toISOString(),
      method: skyMethod,
      decision: decision.action,
      reason: decision.reason,
      args: redactForAudit([toolInput], policy),
    },
    policy.audit.maxEntries,
  );

  if (decision.action === "block") {
    emitDecision({
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `Computer Custom policy blocked ${skyMethod}: ${decision.reason} (${decision.matches.join(", ")})`,
    });
  } else if (decision.action === "confirm") {
    emitDecision({
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: `Computer Custom flagged ${skyMethod} as ${decision.risk}: ${decision.reason} (${decision.matches.join(", ")}). Confirm to proceed.`,
    });
  }

  process.exit(0);
}

const thisFile = fileURLToPath(import.meta.url);
const invokedAs = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedAs === thisFile) {
  await main();
}
