/**
 * Handshake for the server <-> helper pipe.
 *
 * The pipe's ACL already limits connections to the current user. The handshake
 * closes the remaining gap: another process running as the same user must not
 * be able to connect to our pipe and drive the mouse and keyboard through it.
 *
 * The server generates a fresh random token per session, sends it as the first
 * frame, and requires the helper to echo it back before any operation is
 * accepted.
 */

import crypto from "node:crypto";
import { PROTOCOL_VERSION } from "./types.mjs";

/** 32 bytes (256 bits) of entropy. Not guessable within a session lifetime. */
export const HANDSHAKE_TOKEN_BYTES = 32;

export type HandshakeMessage = {
  v: number;
  token: string;
};

export class HandshakeError extends Error {
  readonly code:
    | "TOKEN_MISMATCH"
    | "VERSION_MISMATCH"
    | "MALFORMED";

  constructor(
    code: "TOKEN_MISMATCH" | "VERSION_MISMATCH" | "MALFORMED",
    message: string,
  ) {
    super(message);
    this.name = "HandshakeError";
    this.code = code;
  }
}

/** Fresh random token for one helper session. */
export function createHandshakeToken(): string {
  return crypto.randomBytes(HANDSHAKE_TOKEN_BYTES).toString("hex");
}

/** The challenge the server sends as its first frame. */
export function buildHandshakeMessage(token: string): HandshakeMessage {
  return { v: PROTOCOL_VERSION, token };
}

/**
 * Check the helper's echoed handshake.
 *
 * @throws {HandshakeError} when the shape, version or token is wrong. The
 *   caller must drop the connection on any throw.
 */
export function verifyHandshake(value: unknown, expectedToken: string): void {
  if (value == null || typeof value !== "object") {
    throw new HandshakeError("MALFORMED", "Handshake frame is not an object");
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.token !== "string") {
    throw new HandshakeError("MALFORMED", "Handshake frame has no token string");
  }
  if (candidate.v !== PROTOCOL_VERSION) {
    throw new HandshakeError(
      "VERSION_MISMATCH",
      `Helper speaks protocol ${String(candidate.v)}, server speaks ${PROTOCOL_VERSION}`,
    );
  }

  if (!tokensMatch(candidate.token, expectedToken)) {
    throw new HandshakeError("TOKEN_MISMATCH", "Handshake token did not match");
  }
}

/**
 * Compare tokens without leaking how many leading characters matched.
 *
 * `timingSafeEqual` throws when lengths differ, so length is checked first.
 * Token length is not a secret, only its contents are.
 */
function tokensMatch(received: string, expected: string): boolean {
  const receivedBytes = Buffer.from(received, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (receivedBytes.byteLength !== expectedBytes.byteLength) {
    return false;
  }
  return crypto.timingSafeEqual(receivedBytes, expectedBytes);
}
