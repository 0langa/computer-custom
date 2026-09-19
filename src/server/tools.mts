/**
 * The MCP tools, and the gate every one of them passes through.
 *
 * The shape is deliberately uniform: describe the call, classify it, ask if the
 * policy says to ask, record what happened, then do it. No tool reaches the
 * helper without going through `gated`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type PolicyConfig, classifyToolCall } from "../policy.mjs";
import type { AuditLog } from "./audit.mjs";
import { requestConfirmation } from "./confirm.mjs";
import type { HelperProcess } from "./helper-process.mjs";
import { HelperClientError } from "./helper-client.mjs";
import type { HelperOp } from "../protocol/types.mjs";
import {
  deletePath,
  describeDeleteTarget,
  readTextFile,
  runShell,
  writeTextFile,
} from "./system.mjs";
import { listFlows, resolveFlowsDirectory, runFlow } from "./flows.mjs";
import type { Overlay } from "./overlay.mjs";

/**
 * Set when the user presses the panic hotkey. Every tool call checks it, so a
 * stop is immediate rather than "after the current plan finishes".
 */
export type SessionState = { halted: boolean; reason?: string };

export type ToolContext = {
  helper: HelperProcess;
  policy: PolicyConfig;
  audit: AuditLog;
  mcp: McpServer;
  overlay: Overlay;
  session: SessionState;
};

type ToolResult = {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
  isError?: boolean;
};

/** Present on every tool the policy may gate. */
const confirmArg = {
  confirm: z
    .string()
    .optional()
    .describe(
      'Only for gated actions. The exact phrase the user typed, relayed verbatim. Never write this yourself; ask the user for it.',
    ),
};

function text(value: unknown): ToolResult {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
  };
}

function failure(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Tools that deliver input to whatever application currently has focus.
 *
 * These need the foreground window resolved before the policy can judge them:
 * a click is two numbers, so on its own it can never match a rule about
 * installers or security tools. Without this, every click and keystroke
 * classified as "allow" no matter which application received it.
 */
const INPUT_TOOLS = new Set([
  "click",
  "drag",
  "move",
  "scroll",
  "type_text",
  "key",
  "invoke_element",
  "set_element_value",
  "clipboard_set",
]);

/**
 * Adds the target application to what the policy sees, without sending it to
 * the helper. Best effort: if the foreground cannot be read we classify on the
 * arguments alone rather than failing the call.
 */
async function withTargetContext(
  context: ToolContext,
  tool: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!INPUT_TOOLS.has(tool)) {
    return args;
  }

  try {
    const answer = await context.helper.call("foreground_window");
    const window = answer.result as
      | { process?: string; title?: string; integrity?: string }
      | null
      | undefined;

    if (!window) {
      return args;
    }

    return {
      ...args,
      target: {
        process: window.process,
        title: window.title,
        integrity: window.integrity,
      },
    };
  } catch {
    return args;
  }
}

/**
 * Runs one tool call through policy, confirmation and audit.
 *
 * `summary` is what the user sees if they are asked, so it must describe the
 * real effect in plain words, not repeat the tool name.
 */
async function gated(
  context: ToolContext,
  tool: string,
  rawArgs: Record<string, unknown>,
  summary: string,
  run: (args: Record<string, unknown>) => Promise<ToolResult>,
): Promise<ToolResult> {
  if (context.session.halted) {
    return failure(
      `${context.session.reason ?? "The user stopped this session."} ` +
        "Do not retry. Tell the user the session was halted and wait for them.",
    );
  }

  // The confirmation phrase is not part of the action, and letting it reach the
  // classifier would mean its own text could match a policy pattern.
  const { confirm: suppliedPhrase, ...args } = rawArgs as { confirm?: string } & Record<string, unknown>;

  // Show what is happening before it happens, not after.
  context.overlay.start();
  context.overlay.setState(INPUT_TOOLS.has(tool) ? "acting" : "observing");

  // Classified with the target application attached; executed without it.
  const payload = await withTargetContext(context, tool, args);
  const decision = classifyToolCall(tool, payload, context.policy);

  if (decision.action === "block") {
    context.audit.append({
      tool,
      decision: "block",
      reason: decision.reason,
      args: payload,
    });

    return failure(
      `Blocked by policy: ${decision.reason}. Matched: ${decision.matches.join(", ")}. ` +
        "This is a hard block, not a prompt. Change the policy file if this should be allowed.",
    );
  }

  if (decision.action === "confirm") {
    const target = payload.target as { process?: string; title?: string } | undefined;
    // Red while a human is being asked: the machine is stopped and waiting.
    context.overlay.setState("waiting");
    const outcome = await requestConfirmation(context.mcp.server, {
      tool,
      reason: decision.reason,
      risk: decision.risk,
      phrase: decision.phrase,
      matches: decision.matches,
      // Naming the application matters more than naming the action: the user
      // needs to know WHERE this is about to land.
      summary: target?.process
        ? `${summary}
Target: ${target.process} — ${target.title ?? ""}`.trimEnd()
        : summary,
      suppliedPhrase,
    });

    if (!outcome.approved) {
      context.overlay.setState("idle");
      context.audit.append({
        tool,
        decision: "denied",
        reason: `${decision.reason} (${outcome.via})`,
        args: payload,
      });

      return failure(outcome.message);
    }

    context.audit.append({
      tool,
      decision: "confirm",
      reason: `${decision.reason} (approved via ${outcome.via})`,
      args: payload,
    });
  }

  try {
    if (decision.action === "confirm") {
      context.overlay.setState(INPUT_TOOLS.has(tool) ? "acting" : "observing");
    }

    const result = await run(args);

    // Mark where a click actually landed. The moving cursor shows the journey;
    // this shows the destination, which is what matters afterwards.
    if ((tool === "click" || tool === "drag") && typeof args.x === "number" && typeof args.y === "number") {
      context.overlay.ripple(args.x, args.y);
    } else if (tool === "drag" && typeof args.toX === "number" && typeof args.toY === "number") {
      context.overlay.ripple(args.toX, args.toY);
    }

    if (decision.action === "allow") {
      context.audit.append({ tool, decision: "allow", reason: decision.reason, args: payload, ok: true });
    }

    return result;
  } catch (error) {
    const message = describeError(error);
    context.audit.append({
      tool,
      decision: decision.action === "confirm" ? "confirm" : "allow",
      reason: decision.reason,
      args: payload,
      ok: false,
      error: message,
    });

    return failure(message);
  } finally {
    context.overlay.setState("idle");
  }
}

/**
 * Turns a helper failure into something the agent can act on, rather than a
 * bare message it will simply retry against.
 */
function describeError(error: unknown): string {
  if (!(error instanceof HelperClientError)) {
    return `Failed: ${(error as Error).message}`;
  }

  switch (error.code) {
    case "SECURE_DESKTOP":
      return `${error.message} Do not retry until the user confirms the prompt is gone.`;
    case "UIPI_BLOCKED":
      return `${error.message} This helper runs at normal privilege and cannot drive elevated windows. Tell the user an elevated helper is needed.`;
    case "STALE_HANDLE":
      return `${error.message}`;
    case "NO_TARGET":
      return `${error.message}`;
    case "HELPER_UNAVAILABLE":
      return `The helper is not available: ${error.message}`;
    default:
      return `${error.code}: ${error.message}`;
  }
}

/**
 * Dispatches a tool by name through its registered handler.
 *
 * Flows call this. It is the same function object the MCP layer invokes, so a
 * flow cannot reach a tool by a route that skips the gate.
 */
export type ToolInvoker = (name: string, args: Record<string, unknown>) => Promise<ToolResult>;

export function registerTools(context: ToolContext): ToolInvoker {
  const { mcp, helper } = context;
  const handlers = new Map<string, (args: Record<string, unknown>) => Promise<ToolResult>>();

  const register = (
    name: string,
    // Described structurally rather than with Parameters<>, which collapses to
    // `never` against registerTool's generic overloads.
    config: {
      title?: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
      annotations?: Record<string, unknown>;
    },
    handler: (args: Record<string, unknown>) => Promise<ToolResult>,
  ) => {
    handlers.set(name, handler);
    mcp.registerTool(name, config as never, handler as never);
  };

  const invoke: ToolInvoker = async (name, args) => {
    const handler = handlers.get(name);
    if (!handler) {
      return failure(`Unknown tool: ${name}`);
    }

    return handler(args);
  };

  const passthrough =
    (op: HelperOp) =>
    async (args: Record<string, unknown>): Promise<ToolResult> =>
      text((await helper.call(op, args)).result);

  // ---- look ------------------------------------------------------------

  register(
    "status",
    {
      title: "Status",
      description:
        "What this helper can currently reach: privilege level, whether it has UIAccess, whether a Windows security prompt is on screen, the displays, how the helper was started, and the machine's UAC settings. Call this first in a session, and again after any UIPI_BLOCKED error. If start.notice is present, read it out to the user. uacPromptOnSecureDesktop tells you whether UAC prompts are reachable at all: when true they never are, whatever your privilege.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      gated(context, "ping", {}, "Read helper status.", async () => {
        const answer = await helper.call("ping");
        // The helper reports what it actually got from Windows; startInfo
        // reports what we asked for. When they disagree the agent needs to see
        // both, or it will keep trying to drive windows it cannot reach.
        return text({ ...(answer.result as Record<string, unknown>), start: helper.startInfo });
      }),
  );

  register(
    "list_windows",
    {
      title: "List windows",
      description:
        "Every visible top-level window with its title, process, bounds and integrity level. Start here to pick a target. An integrity level of 'high' means this helper cannot drive that window unless it is itself elevated.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => gated(context, "list_windows", {}, "List open windows.", passthrough("list_windows")),
  );

  register(
    "foreground_window",
    {
      title: "Foreground window",
      description:
        "The window that currently has focus. This is where typing and clicking will land, so check it when you are unsure whether focus went where you expected.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      gated(context, "foreground_window", {}, "Read the focused window.", passthrough("foreground_window")),
  );

  register(
    "ui_tree",
    {
      title: "Read UI tree",
      description:
        "PREFER THIS OVER screenshot. Reads the window's accessibility tree: real control names, values and exact bounds, so clicks land on the right thing. Returns only actionable elements by default. Always check 'truncated' — if true, narrow with depth or raise maxNodes. Fall back to screenshot only for custom-drawn UI, canvases and games.",
      inputSchema: {
        handle: z.number().describe("Window handle from list_windows."),
        depth: z.number().int().min(1).max(60).optional().describe("Traversal depth. Default 25; modern apps nest deeply."),
        interactiveOnly: z
          .boolean()
          .optional()
          .describe("Default true: drop offscreen and unnamed wrapper nodes."),
        maxNodes: z.number().int().min(1).max(4000).optional().describe("Node budget. Default 400."),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => gated(context, "ui_tree", args, "Read a window's UI tree.", passthrough("ui_tree")),
  );

  register(
    "screenshot",
    {
      title: "Screenshot",
      description:
        "Capture the screen, or a region of it, as an image. Use ui_tree first when the window exposes one; pixels cannot tell you a control's name and coordinates drift. Good for custom-drawn UI, canvases, games, and for confirming what actually happened.",
      inputSchema: {
        x: z.number().int().optional(),
        y: z.number().int().optional(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      gated(context, "screenshot", args, "Take a screenshot.", async (inner) => {
        const answer = await helper.call("screenshot", inner);
        if (!answer.binary) {
          return failure("The helper returned no image data.");
        }

        return {
          content: [
            { type: "text", text: JSON.stringify(answer.result) },
            // MCP carries images as base64; the raw bytes only travel over the
            // pipe, where the encoding would be pure overhead.
            { type: "image", data: answer.binary.toString("base64"), mimeType: "image/png" },
          ],
        };
      }),
  );

  register(
    "cursor_position",
    {
      title: "Cursor position",
      description: "Where the mouse pointer is right now.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      gated(context, "cursor_position", {}, "Read the cursor position.", passthrough("cursor_position")),
  );

  register(
    "clipboard_get",
    {
      title: "Read clipboard",
      description: "Read the current clipboard text.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => gated(context, "clipboard_get", {}, "Read the clipboard.", passthrough("clipboard_get")),
  );

  // ---- act -------------------------------------------------------------

  register(
    "focus_window",
    {
      title: "Focus window",
      description: "Bring a window to the front and restore it if minimised. Do this before sending input to it.",
      inputSchema: { handle: z.number().describe("Window handle from list_windows."), ...confirmArg },
      annotations: { readOnlyHint: false },
    },
    async (args) =>
      gated(context, "focus_window", args, "Bring a window to the front.", passthrough("focus_window")),
  );

  register(
    "move",
    {
      title: "Move mouse",
      description: "Move the mouse pointer to a screen position, without clicking.",
      inputSchema: { x: z.number().int(), y: z.number().int(), ...confirmArg },
      annotations: { readOnlyHint: false },
    },
    async (args) => gated(context, "move", args, `Move the mouse.`, passthrough("move")),
  );

  register(
    "click",
    {
      title: "Click",
      description:
        "Click at a screen position. Prefer invoke_element when the target came from ui_tree: it is immune to the window moving. Observe again after clicking; never reuse coordinates from an earlier look.",
      inputSchema: {
        x: z.number().int(),
        y: z.number().int(),
        button: z.enum(["left", "right", "middle"]).optional(),
        count: z.number().int().min(1).max(3).optional().describe("1 single, 2 double, 3 triple."),
        ...confirmArg,
      },
      annotations: { readOnlyHint: false },
    },
    async (args) =>
      gated(context, "click", args, `Click at ${args.x},${args.y}.`, passthrough("click")),
  );

  register(
    "drag",
    {
      title: "Drag",
      description: "Press at one point, move, and release at another. Used for sliders, selections and moving items.",
      inputSchema: {
        fromX: z.number().int(),
        fromY: z.number().int(),
        toX: z.number().int(),
        toY: z.number().int(),
        button: z.enum(["left", "right", "middle"]).optional(),
        ...confirmArg,
      },
      annotations: { readOnlyHint: false },
    },
    async (args) =>
      gated(
        context,
        "drag",
        args,
        `Drag from ${args.fromX},${args.fromY} to ${args.toX},${args.toY}.`,
        passthrough("drag"),
      ),
  );

  register(
    "scroll",
    {
      title: "Scroll",
      description: "Scroll the wheel at a position. Positive dy scrolls up, negative scrolls down.",
      inputSchema: {
        x: z.number().int(),
        y: z.number().int(),
        dx: z.number().int().optional(),
        dy: z.number().int().optional(),
        ...confirmArg,
      },
      annotations: { readOnlyHint: false },
    },
    async (args) => gated(context, "scroll", args, "Scroll.", passthrough("scroll")),
  );

  register(
    "type_text",
    {
      title: "Type text",
      description:
        "Type text into whatever has keyboard focus. Sent as Unicode, so the result does not depend on the keyboard layout. Focus the right field first.",
      inputSchema: { text: z.string(), ...confirmArg },
      annotations: { readOnlyHint: false },
    },
    async (args) =>
      gated(
        context,
        "type_text",
        args,
        `Type ${String(args.text).length} characters into the focused field.`,
        passthrough("type_text"),
      ),
  );

  register(
    "key",
    {
      title: "Press keys",
      description:
        'Press a key or a chord. Give the keys in order, for example ["ctrl","s"] or ["alt","f4"]. Names: ctrl, shift, alt, win, enter, tab, esc, space, backspace, delete, home, end, pageup, pagedown, up, down, left, right, f1-f24, or any single character.',
      inputSchema: { keys: z.array(z.string()).min(1), ...confirmArg },
      annotations: { readOnlyHint: false },
    },
    async (args) =>
      gated(context, "key", args, `Press ${(args.keys as string[]).join("+")}.`, passthrough("key")),
  );

  register(
    "invoke_element",
    {
      title: "Invoke element",
      description:
        "Activate an element by its id from the most recent ui_tree: press a button, toggle a checkbox, select an item, expand a node. More reliable than clicking pixels. Ids expire when you read the tree again.",
      inputSchema: { elementId: z.string().describe("elementId from ui_tree."), ...confirmArg },
      annotations: { readOnlyHint: false },
    },
    async (args) =>
      gated(context, "invoke_element", args, "Activate a UI element.", passthrough("invoke_element")),
  );

  register(
    "set_element_value",
    {
      title: "Set element value",
      description:
        "Write a value straight into a text field by its ui_tree id. Faster and more reliable than focusing and typing, when the control supports it.",
      inputSchema: {
        elementId: z.string().describe("elementId from ui_tree."),
        value: z.string(),
        ...confirmArg,
      },
      annotations: { readOnlyHint: false },
    },
    async (args) =>
      gated(context, "set_element_value", args, "Set a field's value.", passthrough("set_element_value")),
  );

  register(
    "clipboard_set",
    {
      title: "Write clipboard",
      description: "Replace the clipboard text.",
      inputSchema: { text: z.string(), ...confirmArg },
      annotations: { readOnlyHint: false },
    },
    async (args) => gated(context, "clipboard_set", args, "Replace the clipboard.", passthrough("clipboard_set")),
  );

  // ---- shell and files --------------------------------------------------

  register(
    "run_shell",
    {
      title: "Run a command",
      description:
        "Run a shell command and get its output back as text. Use this instead of typing into a terminal window: it is faster, it cannot miss keystrokes, and you get real output rather than pixels. PowerShell by default. Output is capped and the result says if it was truncated.",
      inputSchema: {
        command: z.string().describe("The command line to run."),
        cwd: z.string().optional().describe("Working directory. Defaults to the server's."),
        shell: z.enum(["powershell", "cmd"]).optional(),
        timeoutMs: z.number().int().min(1000).max(600000).optional(),
        ...confirmArg,
      },
      annotations: { readOnlyHint: false },
    },
    async (args) =>
      gated(context, "run_shell", args, `Run: ${String(args.command).slice(0, 200)}`, async (inner) =>
        text(
          await runShell({
            command: String(inner.command),
            cwd: inner.cwd as string | undefined,
            shell: inner.shell as "powershell" | "cmd" | undefined,
            timeoutMs: inner.timeoutMs as number | undefined,
          }),
        ),
      ),
  );

  register(
    "fs_read",
    {
      title: "Read a file",
      description:
        "Read a text file, or list a directory's entries. Output is capped; the result says whether it was truncated.",
      inputSchema: {
        path: z.string(),
        maxBytes: z.number().int().min(1).max(1_000_000).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      gated(context, "fs_read", args, "Read a file.", async (inner) =>
        text(await readTextFile(String(inner.path), inner.maxBytes as number | undefined)),
      ),
  );

  register(
    "fs_write",
    {
      title: "Write a file",
      description: "Write or append text to a file, creating parent directories as needed.",
      inputSchema: {
        path: z.string(),
        content: z.string(),
        append: z.boolean().optional(),
        ...confirmArg,
      },
      annotations: { readOnlyHint: false },
    },
    async (args) =>
      gated(
        context,
        "fs_write",
        args,
        `${args.append === true ? "Append to" : "Overwrite"} ${String(args.path)}.`,
        async (inner) =>
          text(
            await writeTextFile(String(inner.path), String(inner.content), inner.append === true),
          ),
      ),
  );

  register(
    "fs_delete",
    {
      title: "Delete a path",
      description:
        "Delete a file, or a directory with recursive set. This cannot be undone, so it always asks first, whatever the path.",
      inputSchema: {
        path: z.string(),
        recursive: z.boolean().optional().describe("Required to remove a directory that is not empty."),
        ...confirmArg,
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (args) => {
      // The prompt names what is actually there, so "delete this folder" cannot
      // quietly mean "and the four hundred files in it".
      const description = await describeDeleteTarget(String(args.path)).catch(
        () => String(args.path),
      );

      return gated(context, "fs_delete", args, `Permanently delete ${description}.`, async (inner) =>
        text(await deletePath(String(inner.path), inner.recursive === true)),
      );
    },
  );

  // ---- saved flows ------------------------------------------------------

  register(
    "list_flows",
    {
      title: "List saved flows",
      description: "The saved flows available to run, with their descriptions.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      gated(context, "list_flows", {}, "List saved flows.", async () => {
        const directory = resolveFlowsDirectory();
        const flows = await listFlows(directory);
        return text({ directory, flows });
      }),
  );

  register(
    "run_flow",
    {
      title: "Run a saved flow",
      description:
        "Run a saved JavaScript flow by name. Flows get loops and conditions, but every tool call inside one passes the same policy gate as a direct call, so a flow can still be blocked or stop to ask. Returns the flow's log lines and its return value.",
      inputSchema: {
        name: z.string().describe("Flow name from list_flows, without the extension."),
        args: z.record(z.string(), z.unknown()).optional().describe("Passed to the flow as ctx.args."),
        ...confirmArg,
      },
      annotations: { readOnlyHint: false },
    },
    async (args) =>
      gated(context, "run_flow", args, `Run the saved flow '${String(args.name)}'.`, async (inner) =>
        text(
          await runFlow(
            resolveFlowsDirectory(),
            String(inner.name),
            (inner.args as Record<string, unknown> | undefined) ?? {},
            invoke,
          ),
        ),
      ),
  );

  // ---- accountability ---------------------------------------------------

  register(
    "audit",
    {
      title: "Show audit trail",
      description:
        "What this session attempted, including blocked and refused actions, with secrets redacted. Use it to show the user what happened.",
      inputSchema: { limit: z.number().int().min(1).max(200).optional() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const limit = typeof args.limit === "number" ? args.limit : 25;
      return text(context.audit.entries.slice(-limit));
    },
  );

  return invoke;
}
