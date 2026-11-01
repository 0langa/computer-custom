/**
 * The visible-activity overlay, and the user's stop button.
 *
 * A powerful agent driving the machine should not be silent. This starts a
 * separate process that draws a border on every display and reports a panic
 * hotkey. Separate, because the helper's pipe loop blocks on reads and has no
 * Windows message pump; a UI needs one, and a crash in the overlay must not be
 * able to wedge the input path.
 *
 * The overlay is excluded from screen capture, so the agent never photographs
 * its own border. That is verified, not assumed.
 */

import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

export type OverlayState = "idle" | "observing" | "acting" | "waiting";

export type OverlayOptions = {
  executablePath?: string | undefined;
  onPanic?: (() => void) | undefined;
  onSnooze?: ((batchId:string)=>void) | undefined;
  onCancel?: ((batchId:string)=>void) | undefined;
};
export type DesktopNotice={batchId:string;title:string;actions:number;countdownMs:number;maxControlMs:number;inputMode:"block"|"ignore";snoozeMs?:number;x?:number;y?:number};
type NoticeAck={batchId?:string;visible?:boolean;handle?:number};

export class Overlay {
  readonly #options: OverlayOptions;
  #child: ChildProcess | undefined;
  #state: OverlayState = "idle";
  #failed = false;
  #ready = false;
  readonly #pending = new Map<string,{event:string;resolve:(value:NoticeAck)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}>();

  constructor(options: OverlayOptions = {}) {
    this.#options = options;
  }

  get enabled(): boolean {
    // On by default. Being able to see what the agent is doing is the point,
    // so it has to be opted OUT of rather than into.
    const value = process.env.COMPUTER_CUSTOM_OVERLAY;
    return value !== "0" && value?.toLowerCase() !== "false";
  }

  get running(): boolean {
    return this.#child !== undefined && !this.#child.killed;
  }

  /** Starts the overlay if it is enabled and not already up. */
  start(): void {
    if (!this.enabled || this.running || this.#failed) {
      return;
    }

    const executable = this.#options.executablePath ?? resolveOverlayPath();
    if (!executable) {
      // Not a failure worth interrupting anyone over: the plugin works without
      // it, the user simply loses the visual cue.
      this.#failed = true;
      return;
    }

    try {
      const child = spawn(executable, {
        stdio: ["pipe", "pipe", "ignore"],
        // A WinExe has no console to hide. Hiding its first window also hid
        // the user's visible overlay, just as it did the original fixture.
        windowsHide: false,
      });

      child.on("error", () => {
        if(this.#child!==child)return;
        this.#failed = true;
        this.#child = undefined;
        this.#rejectPending();
      });
      child.on("exit", () => {
        if(this.#child!==child)return;
        this.#child = undefined;
        this.#ready=false;this.#rejectPending();
      });

      // Writing to a child that has died raises EPIPE asynchronously, as a
      // stream error rather than a throw, so a try/catch around write cannot
      // catch it. Unhandled, it takes the whole server down over a cosmetic
      // process.
      child.stdin?.on("error", () => {});
      child.stdout?.on("error", () => {});

      let buffered = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        if(this.#child!==child)return;
        buffered += chunk.toString();
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) {
          this.handleEvent(line.trim());
        }
      });

      this.#child = child;
      this.#ready = false;
      this.#send({ state: this.#state });
    } catch {
      this.#failed = true;
    }
  }

  setState(state: OverlayState): void {
    if (this.#state === state) {
      return;
    }

    this.#state = state;
    this.#send({ state });
  }

  stop(): void {
    this.#send({ quit: true });

    try {
      // kill() throws EINVAL when spawn never produced a real process, which
      // is exactly the case when the executable was missing.
      this.#child?.kill();
    } catch {
      // Nothing to stop.
    }

    this.#child = undefined;
    this.#ready=false;this.#rejectPending();
  }

  async showNotice(notice:DesktopNotice):Promise<NoticeAck>{
    this.start();
    if(!this.running)throw new Error("Desktop notification is unavailable. Build/enable the overlay before preparing input.");
    if(!this.#ready)await this.#request("ready");
    return this.#request("notice-shown",{notice});
  }

  async hideNotice(batchId:string):Promise<NoticeAck>{
    if(!this.running)throw new Error("Desktop notification closed before takeover.");
    return this.#request("notice-hidden",{hideNotice:batchId});
  }

  #request(event:string,payload?:Record<string,unknown>):Promise<NoticeAck>{
    return new Promise((resolve,reject)=>{
      const id=randomUUID();
      const timer=setTimeout(()=>{this.#pending.delete(id);reject(new Error(`Desktop notification did not report ${event}.`));},3000);
      this.#pending.set(id,{event,resolve,reject,timer});
      if(payload)this.#send({...payload,requestId:id});
    });
  }

  #rejectPending():void{
    for(const pending of this.#pending.values()){clearTimeout(pending.timer);pending.reject(new Error("Desktop notification process stopped."));}
    this.#pending.clear();
  }

  /**
   * Handles one line of the overlay's output.
   *
   * Public because the stdout reader is not the only legitimate caller: a test
   * needs to drive the path from an event to the panic callback without
   * synthesising a real keypress.
   */
  handleEvent(line: string): void {
    if (line.length === 0) {
      return;
    }

    try {
      const event = JSON.parse(line) as {event?:string;requestId?:string;batchId?:string;visible?:boolean;handle?:number};
      if(event.event==="ready")this.#ready=true;
      for(const [id,pending] of this.#pending){
        if(pending.event===event.event&&(event.event==="ready"||event.requestId===id)){
          clearTimeout(pending.timer);this.#pending.delete(id);pending.resolve(event);
        }
      }
      if(typeof event.batchId==="string"){
        if(event.event==="snooze")this.#options.onSnooze?.(event.batchId);
        if(event.event==="cancel")this.#options.onCancel?.(event.batchId);
      }
      if (event.event === "panic") {
        this.#options.onPanic?.();
      }
    } catch {
      // The overlay is not a trusted source of structure; ignore noise.
    }
  }

  #send(payload: unknown): void {
    if (!this.#child?.stdin?.writable) {
      return;
    }

    try {
      this.#child.stdin.write(`${JSON.stringify(payload)}\n`);
    } catch {
      // A dead overlay must never break a tool call.
    }
  }
}

function resolveOverlayPath(): string | undefined {
  const override = process.env.COMPUTER_CUSTOM_OVERLAY_EXE;
  if (override) {
    return fs.existsSync(override) ? override : undefined;
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "..", "helper", "computer-custom-overlay.exe"),
    path.resolve(here, "..", "..", "helper", "computer-custom-overlay.exe"),
    path.resolve(
      here,
      "..",
      "..",
      "helper",
      "ComputerCustom.Overlay",
      "bin",
      "Debug",
      "net10.0-windows",
      "computer-custom-overlay.exe",
    ),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate));
}
