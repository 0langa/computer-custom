import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FRAME_HEADER_BYTES,
  FrameDecoder,
  FrameError,
  decodeJsonFrame,
  encodeFrame,
  encodeJsonFrame,
} from "../build/protocol/frames.mjs";
import {
  HANDSHAKE_TOKEN_BYTES,
  HandshakeError,
  buildHandshakeMessage,
  createHandshakeToken,
  verifyHandshake,
} from "../build/protocol/handshake.mjs";
import { PROTOCOL_VERSION, READ_ONLY_OPS, isHelperResponse } from "../build/protocol/types.mjs";

describe("frame encoding", () => {
  it("prefixes the payload with its little-endian length", () => {
    const frame = encodeFrame(Buffer.from("hello", "utf8"));

    assert.equal(frame.readUInt32LE(0), 5);
    assert.equal(frame.byteLength, FRAME_HEADER_BYTES + 5);
    assert.equal(frame.subarray(FRAME_HEADER_BYTES).toString("utf8"), "hello");
  });

  it("round-trips a JSON value", () => {
    const value = { id: 7, op: "click", args: { x: 10, y: 20 } };
    const frame = encodeJsonFrame(value);

    assert.deepEqual(decodeJsonFrame(frame.subarray(FRAME_HEADER_BYTES)), value);
  });

  it("refuses to encode a payload above the limit", () => {
    assert.throws(
      () => encodeFrame(Buffer.alloc(11), 10),
      (error) => error instanceof FrameError && error.code === "FRAME_TOO_LARGE",
    );
  });

  it("reports malformed JSON as a frame error", () => {
    assert.throws(
      () => decodeJsonFrame(Buffer.from("{not json", "utf8")),
      (error) => error instanceof FrameError && error.code === "FRAME_INVALID",
    );
  });
});

describe("frame decoding", () => {
  it("reassembles a frame split across chunks", () => {
    const decoder = new FrameDecoder();
    const frame = encodeJsonFrame({ id: 1, ok: true });
    const split = Math.floor(frame.byteLength / 2);

    assert.deepEqual(decoder.push(frame.subarray(0, split)), []);
    assert.ok(decoder.pendingBytes > 0);

    const frames = decoder.push(frame.subarray(split));
    assert.equal(frames.length, 1);
    assert.deepEqual(decodeJsonFrame(frames[0]), { id: 1, ok: true });
    assert.equal(decoder.pendingBytes, 0);
  });

  it("returns several frames arriving in one chunk", () => {
    const decoder = new FrameDecoder();
    const chunk = Buffer.concat([
      encodeJsonFrame({ id: 1, ok: true }),
      encodeJsonFrame({ id: 2, ok: true }),
      encodeJsonFrame({ id: 3, ok: true }),
    ]);

    const frames = decoder.push(chunk);

    assert.equal(frames.length, 3);
    assert.deepEqual(
      frames.map((frame) => decodeJsonFrame(frame).id),
      [1, 2, 3],
    );
  });

  it("keeps a trailing partial frame buffered", () => {
    const decoder = new FrameDecoder();
    const complete = encodeJsonFrame({ id: 1, ok: true });
    const partial = encodeJsonFrame({ id: 2, ok: true }).subarray(0, 3);

    const frames = decoder.push(Buffer.concat([complete, partial]));

    assert.equal(frames.length, 1);
    assert.equal(decoder.pendingBytes, 3);
  });

  it("carries binary payloads through untouched", () => {
    const decoder = new FrameDecoder();
    // A PNG signature: proves we are byte-exact and never treat frames as text.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);

    const frames = decoder.push(encodeFrame(png));

    assert.equal(frames.length, 1);
    assert.ok(Buffer.from(frames[0]).equals(png));
  });

  it("rejects a declared length above the limit", () => {
    const decoder = new FrameDecoder(16);
    const header = Buffer.allocUnsafe(FRAME_HEADER_BYTES);
    header.writeUInt32LE(9_999_999, 0);

    assert.throws(
      () => decoder.push(header),
      (error) => error instanceof FrameError && error.code === "FRAME_TOO_LARGE",
    );
  });

  it("drops buffered bytes on reset", () => {
    const decoder = new FrameDecoder();
    decoder.push(encodeJsonFrame({ id: 1, ok: true }).subarray(0, 3));
    assert.ok(decoder.pendingBytes > 0);

    decoder.reset();

    assert.equal(decoder.pendingBytes, 0);
  });
});

describe("handshake", () => {
  it("creates a token with full entropy", () => {
    const token = createHandshakeToken();

    assert.equal(token.length, HANDSHAKE_TOKEN_BYTES * 2);
    assert.match(token, /^[0-9a-f]+$/);
    assert.notEqual(token, createHandshakeToken());
  });

  it("accepts the matching token at the current version", () => {
    const token = createHandshakeToken();

    assert.doesNotThrow(() => verifyHandshake(buildHandshakeMessage(token), token));
  });

  it("rejects a different token", () => {
    const token = createHandshakeToken();

    assert.throws(
      () => verifyHandshake(buildHandshakeMessage(createHandshakeToken()), token),
      (error) => error instanceof HandshakeError && error.code === "TOKEN_MISMATCH",
    );
  });

  it("rejects a token of a different length without throwing", () => {
    const token = createHandshakeToken();

    assert.throws(
      () => verifyHandshake({ v: PROTOCOL_VERSION, token: "abc" }, token),
      (error) => error instanceof HandshakeError && error.code === "TOKEN_MISMATCH",
    );
  });

  it("rejects a mismatched protocol version", () => {
    const token = createHandshakeToken();

    assert.throws(
      () => verifyHandshake({ v: PROTOCOL_VERSION + 1, token }, token),
      (error) => error instanceof HandshakeError && error.code === "VERSION_MISMATCH",
    );
  });

  it("rejects malformed handshake frames", () => {
    const token = createHandshakeToken();

    for (const malformed of [null, "token", 42, {}, { v: PROTOCOL_VERSION }]) {
      assert.throws(
        () => verifyHandshake(malformed, token),
        (error) => error instanceof HandshakeError && error.code === "MALFORMED",
      );
    }
  });
});

describe("protocol types", () => {
  it("treats observation operations as read-only", () => {
    for (const op of ["ping", "screenshot", "list_windows", "ui_tree"]) {
      assert.ok(READ_ONLY_OPS.has(op), `${op} should be read-only`);
    }
  });

  it("does not treat input operations as read-only", () => {
    for (const op of ["click", "type_text", "key", "drag", "clipboard_set"]) {
      assert.ok(!READ_ONLY_OPS.has(op), `${op} must not be read-only`);
    }
  });

  it("recognises well-formed helper responses", () => {
    assert.ok(isHelperResponse({ id: 1, ok: true }));
    assert.ok(isHelperResponse({ id: 2, ok: false, error: { code: "BAD_ARGS", message: "x" } }));
    assert.ok(!isHelperResponse({ ok: true }));
    assert.ok(!isHelperResponse(null));
  });
});
