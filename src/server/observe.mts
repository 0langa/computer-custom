import { randomUUID } from "node:crypto";
import { HelperClientError, type HelperCallOptions, type HelperCallResult } from "./helper-client.mjs";
import type { NativeWorker } from "./desktop-workers.mjs";

export type WindowTarget = { handle: number; pid: number; processStartTime: string | null };
export type ObserveRequest = {
  target: WindowTarget;
  mode?: "combined" | "tree" | "image" | "targeted";
  query?: string;
  depth?: number;
  maxNodes?: number;
};
type Rect = { x: number; y: number; width: number; height: number };
type UiNode = Rect & {
  elementId: string; role: string; name: string; value?: string; automationId?: string;
  enabled?: boolean; offscreen?: boolean; invokable?: boolean; children: UiNode[];
};
type UiTree = { root: UiNode; observationId: string; truncated: boolean; windowX?: number; windowY?: number };

/** One caller deadline covers startup and every observation source. */
export async function observe(worker: NativeWorker, request: ObserveRequest, options: HelperCallOptions = {}): Promise<HelperCallResult> {
  if (options.signal?.aborted) throw new HelperClientError("CANCELLED", "Observation cancelled");
  const started = performance.now();
  const deadline = started + (options.timeoutMs ?? 2000);
  const budget = (): HelperCallOptions => ({ ...options, timeoutMs: Math.max(1, Math.ceil(deadline - performance.now())) });
  const mode = request.mode ?? "combined";
  if (mode === "targeted" && !request.query?.trim()) throw new HelperClientError("BAD_ARGS", "Targeted observation needs a query.");
  const target = (await worker.call("resolve_target", { target: request.target }, budget())).result as WindowTarget & Rect;
  const jobs: Array<{source: "tree" | "image"; promise: Promise<HelperCallResult>}> = [];
  if (mode !== "image") jobs.push({source:"tree",promise:worker.call("ui_tree",{
    handle:target.handle,depth:request.depth ?? 25,maxNodes:request.maxNodes ?? 400,interactiveOnly:true,
  },budget())});
  if (mode === "combined" || mode === "image") jobs.push({source:"image",promise:worker.call("window_capture",{target:request.target},budget())});
  const outcomes = await Promise.allSettled(jobs.map(job=>job.promise));
  if (options.signal?.aborted) throw new HelperClientError("CANCELLED", "Observation cancelled");
  const result: Record<string, unknown> = {
    observationId:randomUUID(), target, coordinateSpace:"window", capturedAt:new Date().toISOString(),
  };
  const errors: Array<{source:string;code?:string;message:string}> = [];
  let binary: Buffer | undefined;
  let successes = 0;
  for (const [index, outcome] of outcomes.entries()) {
    const source = jobs[index]!.source;
    if (outcome.status === "rejected") {
      const error = outcome.reason as Error & {code?:string};
      errors.push({source,code:error.code,message:error.message});
      continue;
    }
    successes++;
    if (source === "image") {
      result.image = outcome.value.result;
      binary = outcome.value.binary;
    } else {
      const tree = outcome.value.result as UiTree;
      result.observationId = tree.observationId;
      result.truncated = tree.truncated;
      const elements: Array<Record<string, unknown>> = [];
      const query = request.query?.trim().toLocaleLowerCase();
      const visit = (node: UiNode) => {
        if (!query || `${node.name} ${node.automationId ?? ""} ${node.role}`.toLocaleLowerCase().includes(query)) {
          elements.push({elementId:node.elementId,role:node.role,name:node.name,
            ...(node.value ? {value:node.value}:{}), ...(node.automationId ? {automationId:node.automationId}:{}),
            enabled:node.enabled,offscreen:node.offscreen,invokable:node.invokable,
            bounds:{x:node.x-(tree.windowX ?? target.x),y:node.y-(tree.windowY ?? target.y),width:node.width,height:node.height}});
        }
        for (const child of node.children) visit(child);
      };
      visit(tree.root);
      result.elements = elements;
    }
  }
  if (successes === 0) throw new HelperClientError("HELPER_UNAVAILABLE", errors.map(e=>`${e.source}: ${e.message}`).join("; "));
  result.partial = errors.length > 0;
  result.errors = errors;
  result.durationMs = performance.now()-started;
  return {result,...(binary ? {binary} : {})};
}
