import { HelperProcess, type HelperStartInfo, type HelperProcessOptions } from "./helper-process.mjs";
import type { HelperCallOptions, HelperCallResult } from "./helper-client.mjs";
import type { HelperOp } from "../protocol/types.mjs";

export interface NativeWorker {
  call(op: HelperOp, args?: Record<string, unknown>, options?: HelperCallOptions): Promise<HelperCallResult>;
  stop(): void;
  readonly startInfo?: HelperStartInfo;
}

const UIA_OPERATIONS = new Set<HelperOp>(["ui_tree", "resolve_element", "invoke_element", "set_element_value"]);

/** UIA providers can block COM indefinitely. They never run in the input worker. */
export class DesktopWorkers implements NativeWorker {
  readonly control: NativeWorker;
  readonly observation: NativeWorker;
  readonly capture: NativeWorker;

  constructor(options: {control?: NativeWorker; observation?: NativeWorker; capture?: NativeWorker;helper?:HelperProcessOptions} = {}) {
    this.control = options.control ?? new HelperProcess(options.helper);
    this.observation = options.observation ?? new HelperProcess(options.helper);
    this.capture = options.capture ?? new HelperProcess(options.helper);
  }

  get startInfo(): HelperStartInfo | undefined { return this.control.startInfo; }

  call(op: HelperOp, args: Record<string, unknown> = {}, options: HelperCallOptions = {}): Promise<HelperCallResult> {
    if (UIA_OPERATIONS.has(op)) {
      return this.observation.call(op, args, { ...options, timeoutMs: options.timeoutMs ?? 2000 });
    }
    if (op === "window_capture" || op === "screenshot") {
      return this.capture.call(op, args, { ...options, timeoutMs: options.timeoutMs ?? 2000 });
    }
    return this.control.call(op, args, options);
  }

  stop(): void {
    this.control.stop();
    this.observation.stop();
    this.capture.stop();
  }
}
