/**
 * Length-prefixed framing for the server <-> helper pipe.
 *
 * Wire format per frame: 4-byte little-endian unsigned length, then exactly
 * that many bytes of payload. JSON frames carry UTF-8 JSON. Binary frames
 * carry raw bytes (PNG screenshots) so we avoid the ~33% cost of base64.
 */

/** 4-byte little-endian length prefix. */
export const FRAME_HEADER_BYTES = 4;

/**
 * Hard ceiling for a single frame. A 4K screenshot is a few megabytes, so 64 MB
 * leaves generous headroom while still refusing a corrupt or hostile length.
 */
export const MAX_FRAME_BYTES = 64 * 1024 * 1024;

export class FrameError extends Error {
  readonly code: "FRAME_TOO_LARGE" | "FRAME_INVALID";

  constructor(code: "FRAME_TOO_LARGE" | "FRAME_INVALID", message: string) {
    super(message);
    this.name = "FrameError";
    this.code = code;
  }
}

/** Wrap a payload in its length prefix. */
export function encodeFrame(
  payload: Uint8Array,
  maxFrameBytes: number = MAX_FRAME_BYTES,
): Buffer {
  if (payload.byteLength > maxFrameBytes) {
    throw new FrameError(
      "FRAME_TOO_LARGE",
      `Frame of ${payload.byteLength} bytes exceeds the ${maxFrameBytes} byte limit`,
    );
  }
  const header = Buffer.allocUnsafe(FRAME_HEADER_BYTES);
  header.writeUInt32LE(payload.byteLength, 0);
  return Buffer.concat([header, Buffer.from(payload)]);
}

/** Wrap a JSON-serialisable value in a frame. */
export function encodeJsonFrame(
  value: unknown,
  maxFrameBytes: number = MAX_FRAME_BYTES,
): Buffer {
  return encodeFrame(Buffer.from(JSON.stringify(value), "utf8"), maxFrameBytes);
}

/** Parse a JSON frame payload. Throws `FrameError` on malformed JSON. */
export function decodeJsonFrame(payload: Uint8Array): unknown {
  const text = Buffer.from(payload).toString("utf8");
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new FrameError(
      "FRAME_INVALID",
      `Frame payload is not valid JSON: ${(error as Error).message}`,
    );
  }
}

/**
 * Reassembles frames from a byte stream.
 *
 * A pipe hands us arbitrary chunks: a frame may arrive split across several
 * chunks, and one chunk may hold several frames. Feed every chunk to `push`
 * and it returns whichever complete frames became available.
 */
export class FrameDecoder {
  readonly #maxFrameBytes: number;
  #buffered: Buffer = Buffer.alloc(0);

  constructor(maxFrameBytes: number = MAX_FRAME_BYTES) {
    this.#maxFrameBytes = maxFrameBytes;
  }

  /** Bytes held back waiting for the rest of their frame. */
  get pendingBytes(): number {
    return this.#buffered.byteLength;
  }

  /**
   * Add a chunk and take out every frame that is now complete.
   *
   * @throws {FrameError} when a declared length exceeds the configured limit.
   *   The caller must drop the connection: once a length is untrustworthy we
   *   can no longer find where the next frame starts.
   */
  push(chunk: Uint8Array): Buffer[] {
    this.#buffered =
      this.#buffered.byteLength === 0
        ? Buffer.from(chunk)
        : Buffer.concat([this.#buffered, Buffer.from(chunk)]);

    const frames: Buffer[] = [];
    let offset = 0;

    while (this.#buffered.byteLength - offset >= FRAME_HEADER_BYTES) {
      const length = this.#buffered.readUInt32LE(offset);
      if (length > this.#maxFrameBytes) {
        throw new FrameError(
          "FRAME_TOO_LARGE",
          `Declared frame length ${length} exceeds the ${this.#maxFrameBytes} byte limit`,
        );
      }

      const frameEnd = offset + FRAME_HEADER_BYTES + length;
      if (this.#buffered.byteLength < frameEnd) {
        break;
      }

      frames.push(this.#buffered.subarray(offset + FRAME_HEADER_BYTES, frameEnd));
      offset = frameEnd;
    }

    this.#buffered =
      offset === 0 ? this.#buffered : this.#buffered.subarray(offset);
    return frames;
  }

  /** Drop any partial frame. Used when a connection is reset. */
  reset(): void {
    this.#buffered = Buffer.alloc(0);
  }
}
