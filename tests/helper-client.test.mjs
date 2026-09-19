import assert from "node:assert/strict";
import crypto from "node:crypto";
import net from "node:net";
import { afterEach, describe, it } from "node:test";
import {
  FrameDecoder,
  decodeJsonFrame,
  encodeFrame,
  encodeJsonFrame,
} from "../build/protocol/frames.mjs";
import { buildHandshakeMessage, createHandshakeToken } from "../build/protocol/handshake.mjs";
import { HelperClient, HelperClientError } from "../build/server/helper-client.mjs";

const openClients = [];
const openHelpers = [];

afterEach(async () => {
  for (const client of openClients.splice(0)) {
    client.close();
  }
  for (const helper of openHelpers.splice(0)) {
    await helper.close();
  }
});

/**
 * Stands in for the native helper: owns the pipe and speaks first, exactly as
 * docs/PROTOCOL.md requires of the real one.
 */
function startFakeHelper({ token, onRequest, skipHandshake = false }) {
  const pipePath = `\\\\.\\pipe\\computer-custom-test-${crypto.randomUUID()}`;
  const sockets = [];

  const server = net.createServer((socket) => {
    sockets.push(socket);
    const decoder = new FrameDecoder();

    if (!skipHandshake) {
      socket.write(encodeJsonFrame(buildHandshakeMessage(token)));
    }

    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      for (const frame of decoder.push(chunk)) {
        const request = decodeJsonFrame(frame);
        const reply = onRequest?.(request);
        if (!reply) {
          continue;
        }
        socket.write(encodeJsonFrame(reply.response));
        if (reply.binary) {
          socket.write(encodeFrame(reply.binary));
        }
      }
    });
  });

  const listening = new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
    server.listen(pipePath);
  });

  const helper = {
    pipePath,
    listening,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) {
          socket.destroy();
        }
        server.close(() => resolve());
      }),
  };
  openHelpers.push(helper);
  return helper;
}

function trackClient(client) {
  openClients.push(client);
  return client;
}

describe("helper client handshake", () => {
  it("connects once the helper proves the shared token", async () => {
    const token = createHandshakeToken();
    const helper = startFakeHelper({ token });
    await helper.listening;

    const client = trackClient(new HelperClient({ pipePath: helper.pipePath, token }));
    await client.connect();

    assert.equal(client.connected, true);
  });

  it("refuses a helper that presents the wrong token", async () => {
    const token = createHandshakeToken();
    const helper = startFakeHelper({ token: createHandshakeToken() });
    await helper.listening;

    const client = trackClient(new HelperClient({ pipePath: helper.pipePath, token }));

    await assert.rejects(
      client.connect(),
      (error) =>
        error instanceof HelperClientError && error.code === "HELPER_UNAVAILABLE",
    );
    assert.equal(client.connected, false);
  });

  it("gives up on a helper that never proves itself", async () => {
    const token = createHandshakeToken();
    const helper = startFakeHelper({ token, skipHandshake: true });
    await helper.listening;

    const client = trackClient(
      new HelperClient({ pipePath: helper.pipePath, token, handshakeTimeoutMs: 150 }),
    );

    await assert.rejects(
      client.connect(),
      (error) => error instanceof HelperClientError && error.code === "HELPER_UNAVAILABLE",
    );
  });

  it("fails to connect when no helper owns the pipe", async () => {
    const client = trackClient(
      new HelperClient({
        pipePath: `\\\\.\\pipe\\computer-custom-absent-${crypto.randomUUID()}`,
        token: createHandshakeToken(),
        handshakeTimeoutMs: 500,
      }),
    );

    await assert.rejects(client.connect());
  });
});

describe("helper client calls", () => {
  it("correlates a response with its request", async () => {
    const token = createHandshakeToken();
    const helper = startFakeHelper({
      token,
      onRequest: (request) => ({
        response: { id: request.id, ok: true, result: { op: request.op } },
      }),
    });
    await helper.listening;

    const client = trackClient(new HelperClient({ pipePath: helper.pipePath, token }));
    await client.connect();

    const answer = await client.call("ping");

    assert.deepEqual(answer.result, { op: "ping" });
  });

  it("keeps concurrent calls apart", async () => {
    const token = createHandshakeToken();
    const helper = startFakeHelper({
      token,
      onRequest: (request) => ({
        response: { id: request.id, ok: true, result: request.args?.tag },
      }),
    });
    await helper.listening;

    const client = trackClient(new HelperClient({ pipePath: helper.pipePath, token }));
    await client.connect();

    const answers = await Promise.all([
      client.call("list_windows", { tag: "a" }),
      client.call("list_windows", { tag: "b" }),
      client.call("list_windows", { tag: "c" }),
    ]);

    assert.deepEqual(
      answers.map((answer) => answer.result),
      ["a", "b", "c"],
    );
  });

  it("delivers the follow-up binary frame with its response", async () => {
    const token = createHandshakeToken();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03]);
    const helper = startFakeHelper({
      token,
      onRequest: (request) => ({
        response: {
          id: request.id,
          ok: true,
          result: { width: 1920, height: 1080 },
          binary: { kind: "png", byteLength: png.byteLength },
        },
        binary: png,
      }),
    });
    await helper.listening;

    const client = trackClient(new HelperClient({ pipePath: helper.pipePath, token }));
    await client.connect();

    const answer = await client.call("screenshot");

    assert.deepEqual(answer.result, { width: 1920, height: 1080 });
    assert.ok(answer.binary?.equals(png));
  });

  it("surfaces a helper error with its code intact", async () => {
    const token = createHandshakeToken();
    const helper = startFakeHelper({
      token,
      onRequest: (request) => ({
        response: {
          id: request.id,
          ok: false,
          error: { code: "SECURE_DESKTOP", message: "A UAC prompt is showing" },
        },
      }),
    });
    await helper.listening;

    const client = trackClient(new HelperClient({ pipePath: helper.pipePath, token }));
    await client.connect();

    await assert.rejects(
      client.call("click", { x: 1, y: 1 }),
      (error) =>
        error instanceof HelperClientError &&
        error.code === "SECURE_DESKTOP" &&
        /UAC prompt/.test(error.message),
    );
  });

  it("times out a call the helper never answers", async () => {
    const token = createHandshakeToken();
    const helper = startFakeHelper({ token, onRequest: () => undefined });
    await helper.listening;

    const client = trackClient(
      new HelperClient({ pipePath: helper.pipePath, token, requestTimeoutMs: 150 }),
    );
    await client.connect();

    await assert.rejects(
      client.call("ping"),
      (error) =>
        error instanceof HelperClientError && error.code === "HELPER_UNAVAILABLE",
    );
  });

  it("rejects calls made before connecting", async () => {
    const client = trackClient(
      new HelperClient({ pipePath: "\\\\.\\pipe\\unused", token: createHandshakeToken() }),
    );

    await assert.rejects(
      client.call("ping"),
      (error) =>
        error instanceof HelperClientError && error.code === "HELPER_UNAVAILABLE",
    );
  });

  it("fails pending calls when the helper goes away", async () => {
    const token = createHandshakeToken();
    const helper = startFakeHelper({ token, onRequest: () => undefined });
    await helper.listening;

    const client = trackClient(new HelperClient({ pipePath: helper.pipePath, token }));
    await client.connect();

    const pending = client.call("ping");
    await helper.close();

    await assert.rejects(
      pending,
      (error) =>
        error instanceof HelperClientError && error.code === "HELPER_UNAVAILABLE",
    );
  });
});
