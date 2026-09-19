/**
 * Transport between the MCP server and the native helper.
 *
 * The helper owns the named pipe and proves its identity first; see the pipe
 * security notes in docs/PROTOCOL.md for why the direction is that way round.
 * This module is responsible for connecting, verifying, correlating requests
 * with responses, and surfacing failures as typed helper errors.
 */

import net from "node:net";
import {
  FrameDecoder,
  decodeJsonFrame,
  encodeJsonFrame,
} from "../protocol/frames.mjs";
import { verifyHandshake } from "../protocol/handshake.mjs";
import {
  type HelperError,
  type HelperErrorCode,
  type HelperOp,
  type HelperResponse,
  isHelperResponse,
} from "../protocol/types.mjs";

/** How long a single helper operation may take before we give up on it. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** How long to wait for the helper to prove itself after we connect. */
export const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000;

export class HelperClientError extends Error {
  readonly code: HelperErrorCode;

  constructor(code: HelperErrorCode, message: string) {
    super(message);
    this.name = "HelperClientError";
    this.code = code;
  }
}

export type HelperCallResult = {
  result: unknown;
  /** Raw bytes from the follow-up frame, present for `screenshot`. */
  binary?: Buffer;
};

export type HelperClientOptions = {
  pipePath: string;
  token: string;
  requestTimeoutMs?: number;
  handshakeTimeoutMs?: number;
};

type PendingCall = {
  resolve: (value: HelperCallResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  /** Set once a response announced a binary frame we are still waiting for. */
  awaitingBinary?: { byteLength: number; result: unknown };
};

export class HelperClient {
  readonly #options: Required<HelperClientOptions>;
  readonly #decoder = new FrameDecoder();
  readonly #pending = new Map<number, PendingCall>();

  #socket: net.Socket | undefined;
  #nextId = 1;
  #verified = false;
  #closed = false;
  /** Set when a response frame announced binary data that has not arrived. */
  #binaryTarget: { id: number; byteLength: number } | undefined;
  #handshakeResolve: (() => void) | undefined;
  #handshakeReject: ((error: Error) => void) | undefined;

  constructor(options: HelperClientOptions) {
    this.#options = {
      requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
      handshakeTimeoutMs: DEFAULT_HANDSHAKE_TIMEOUT_MS,
      ...options,
    };
  }

  get connected(): boolean {
    return this.#verified && !this.#closed;
  }

  /**
   * Connect to the helper's pipe and wait for it to prove the shared token.
   *
   * Resolves only once the handshake has been verified, so a caller that
   * awaits this can assume any later `call` reaches the real helper.
   */
  async connect(): Promise<void> {
    if (this.#socket) {
      throw new HelperClientError("INTERNAL", "Helper client is already connected");
    }

    const socket = net.createConnection({ path: this.#options.pipePath });
    this.#socket = socket;
    socket.on("data", (chunk) => this.#onData(chunk));
    socket.on("error", (error) => this.#failAll("HELPER_UNAVAILABLE", error.message));
    socket.on("close", () => this.#failAll("HELPER_UNAVAILABLE", "Helper pipe closed"));

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        this.close();
        reject(
          new HelperClientError(
            "HELPER_UNAVAILABLE",
            `Helper did not complete the handshake within ${this.#options.handshakeTimeoutMs}ms`,
          ),
        );
      }, this.#options.handshakeTimeoutMs);

      const onVerified = () => {
        cleanup();
        resolve();
      };
      const onFailed = (error: Error) => {
        cleanup();
        this.close();
        reject(error);
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.#handshakeResolve = undefined;
        this.#handshakeReject = undefined;
      };

      this.#handshakeResolve = onVerified;
      this.#handshakeReject = onFailed;

      socket.once("error", (error) => onFailed(
        new HelperClientError("HELPER_UNAVAILABLE", error.message),
      ));
    });
  }

  /** Send one operation and wait for its response. */
  async call(op: HelperOp, args: Record<string, unknown> = {}): Promise<HelperCallResult> {
    if (!this.connected || !this.#socket) {
      throw new HelperClientError("HELPER_UNAVAILABLE", "Helper is not connected");
    }

    const id = this.#nextId++;
    const socket = this.#socket;

    return new Promise<HelperCallResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(
          new HelperClientError(
            "HELPER_UNAVAILABLE",
            `Helper did not answer ${op} within ${this.#options.requestTimeoutMs}ms`,
          ),
        );
      }, this.#options.requestTimeoutMs);

      this.#pending.set(id, { resolve, reject, timer });
      socket.write(encodeJsonFrame({ id, op, args }));
    });
  }

  close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#socket?.destroy();
    this.#socket = undefined;
    this.#failAll("HELPER_UNAVAILABLE", "Helper client closed");
  }

  #onData(chunk: Buffer): void {
    let frames: Buffer[];
    try {
      frames = this.#decoder.push(chunk);
    } catch (error) {
      this.#rejectHandshake(error as Error);
      this.#failAll("INTERNAL", (error as Error).message);
      this.close();
      return;
    }

    for (const frame of frames) {
      this.#onFrame(frame);
    }
  }

  #onFrame(frame: Buffer): void {
    // A response may announce a binary payload; that payload is the very next
    // frame and is not JSON, so it must be claimed before we try to parse.
    if (this.#binaryTarget) {
      const target = this.#binaryTarget;
      this.#binaryTarget = undefined;
      const pending = this.#pending.get(target.id);
      this.#pending.delete(target.id);
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve({
          result: pending.awaitingBinary?.result,
          binary: Buffer.from(frame),
        });
      }
      return;
    }

    let message: unknown;
    try {
      message = decodeJsonFrame(frame);
    } catch (error) {
      this.#rejectHandshake(error as Error);
      this.#failAll("INTERNAL", (error as Error).message);
      this.close();
      return;
    }

    if (!this.#verified) {
      this.#onHandshakeFrame(message);
      return;
    }

    if (!isHelperResponse(message)) {
      this.#failAll("INTERNAL", "Helper sent a frame that is not a response");
      this.close();
      return;
    }

    this.#onResponse(message);
  }

  #onHandshakeFrame(message: unknown): void {
    try {
      verifyHandshake(message, this.#options.token);
    } catch (error) {
      this.#rejectHandshake(
        new HelperClientError("HELPER_UNAVAILABLE", (error as Error).message),
      );
      this.close();
      return;
    }

    this.#verified = true;
    this.#handshakeResolve?.();
  }

  #onResponse(message: HelperResponse): void {
    const pending = this.#pending.get(message.id);
    if (!pending) {
      // Late answer to a call we already timed out. Nothing to do.
      return;
    }

    if (!message.ok) {
      this.#pending.delete(message.id);
      clearTimeout(pending.timer);
      pending.reject(toHelperClientError(message.error));
      return;
    }

    if (message.binary) {
      // Keep the call pending; the bytes arrive in the next frame.
      pending.awaitingBinary = {
        byteLength: message.binary.byteLength,
        result: message.result,
      };
      this.#binaryTarget = { id: message.id, byteLength: message.binary.byteLength };
      return;
    }

    this.#pending.delete(message.id);
    clearTimeout(pending.timer);
    pending.resolve({ result: message.result });
  }

  #rejectHandshake(error: Error): void {
    this.#handshakeReject?.(error);
  }

  #failAll(code: HelperErrorCode, message: string): void {
    for (const [id, pending] of this.#pending) {
      this.#pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(new HelperClientError(code, message));
    }
  }
}

function toHelperClientError(error: HelperError): HelperClientError {
  return new HelperClientError(error.code, error.message);
}
