/**
 * Saved flows: reusable scripts for repeated work, written in JavaScript.
 *
 * A flow gets real control flow — loops, conditions, retries — because that is
 * what repeated testing work actually needs. What it does NOT get is a private
 * route to the machine: every tool call a flow makes goes through the same
 * invoker the agent uses, so the same policy, confirmation and audit apply.
 *
 * Be clear about the boundary. The flow's own JavaScript is not sandboxed. It
 * is the user's code, running in the server process with whatever Node can do,
 * exactly like a script they would run themselves. The guarantee here is about
 * the *tools*, not about containing arbitrary code. Anyone who can write into
 * the flows directory can run code as this user.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ToolInvoker } from "./tools.mjs";

const FLOW_EXTENSIONS = new Set([".mjs", ".js"]);

/** Tool names a flow can call as `cc.<name>(args)`. */
const FLOW_TOOLS = [
  "status",
  "list_windows",
  "foreground_window",
  "focus_window",
  "ui_tree",
  "screenshot",
  "cursor_position",
  "move",
  "click",
  "drag",
  "scroll",
  "type_text",
  "key",
  "invoke_element",
  "set_element_value",
  "clipboard_get",
  "clipboard_set",
  "run_shell",
  "fs_read",
  "fs_write",
  "fs_delete",
] as const;

export type FlowSummary = {
  name: string;
  description: string;
  path: string;
};

export type FlowRunResult = {
  flow: string;
  ok: boolean;
  logs: string[];
  result?: unknown;
  error?: string;
};

export function resolveFlowsDirectory(): string {
  return process.env.COMPUTER_CUSTOM_FLOWS ?? path.resolve(process.cwd(), "flows");
}

export async function listFlows(directory: string): Promise<FlowSummary[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => undefined);
  if (!entries) {
    return [];
  }

  const flows: FlowSummary[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !FLOW_EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }

    const filePath = path.join(directory, entry.name);
    flows.push({
      name: path.basename(entry.name, path.extname(entry.name)),
      description: await readDescription(filePath),
      path: filePath,
    });
  }

  return flows.sort((a, b) => a.name.localeCompare(b.name));
}

export async function runFlow(
  directory: string,
  name: string,
  args: Record<string, unknown>,
  invoke: ToolInvoker,
): Promise<FlowRunResult> {
  const file = await findFlowFile(directory, name);
  if (!file) {
    const available = (await listFlows(directory)).map((flow) => flow.name);
    return {
      flow: name,
      ok: false,
      logs: [],
      error:
        available.length > 0
          ? `No flow called '${name}'. Available: ${available.join(", ")}`
          : `No flow called '${name}', and no flows found in ${directory}.`,
    };
  }

  const logs: string[] = [];
  const context = buildFlowContext(invoke, args, logs);

  try {
    // The query string defeats the module cache, so editing a flow and running
    // it again actually runs the new version.
    const module = (await import(`${pathToFileURL(file).href}?v=${Date.now()}`)) as {
      default?: unknown;
    };

    if (typeof module.default !== "function") {
      return {
        flow: name,
        ok: false,
        logs,
        error: `${file} must 'export default' a function taking the flow context.`,
      };
    }

    const result = await (module.default as (ctx: unknown) => Promise<unknown>)(context);
    return { flow: name, ok: true, logs, result };
  } catch (error) {
    return { flow: name, ok: false, logs, error: (error as Error).message };
  }
}

/**
 * The object a flow receives.
 *
 * Each tool is a method that throws on failure, because a flow is a script:
 * it should stop at the first thing that did not work, not carry on against a
 * window that never opened.
 */
function buildFlowContext(
  invoke: ToolInvoker,
  args: Record<string, unknown>,
  logs: string[],
): Record<string, unknown> {
  const call = async (tool: string, toolArgs: Record<string, unknown> = {}): Promise<unknown> => {
    const result = await invoke(tool, toolArgs);
    const body = result.content.find((part) => part.type === "text");
    const textBody = body && "text" in body ? body.text : "";

    if (result.isError) {
      throw new Error(`${tool} failed: ${textBody}`);
    }

    try {
      return JSON.parse(textBody) as unknown;
    } catch {
      return textBody;
    }
  };

  const context: Record<string, unknown> = {
    args,
    call,
    log: (message: unknown) => {
      logs.push(String(message));
    },
    sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  };

  for (const tool of FLOW_TOOLS) {
    context[tool] = (toolArgs: Record<string, unknown> = {}) => call(tool, toolArgs);
  }

  return context;
}

async function findFlowFile(directory: string, name: string): Promise<string | undefined> {
  // Names are treated as bare identifiers, never paths, so a flow name cannot
  // walk out of the flows directory.
  const safe = path.basename(name, path.extname(name));
  for (const extension of FLOW_EXTENSIONS) {
    const candidate = path.join(directory, `${safe}${extension}`);
    if (await exists(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

async function readDescription(filePath: string): Promise<string> {
  const source = await fs.readFile(filePath, "utf8").catch(() => "");
  const match = /export\s+const\s+description\s*=\s*(["'`])([\s\S]*?)\1/.exec(source);
  return match?.[2]?.trim() ?? "";
}

async function exists(candidate: string): Promise<boolean> {
  return fs
    .access(candidate)
    .then(() => true)
    .catch(() => false);
}
