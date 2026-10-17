// build/server/helper-process.mjs
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import crypto2 from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// build/server/helper-client.mjs
import net from "node:net";

// build/protocol/frames.mjs
var FRAME_HEADER_BYTES = 4;
var MAX_FRAME_BYTES = 64 * 1024 * 1024;
var FrameError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "FrameError";
    this.code = code;
  }
};
function encodeFrame(payload, maxFrameBytes = MAX_FRAME_BYTES) {
  if (payload.byteLength > maxFrameBytes) {
    throw new FrameError("FRAME_TOO_LARGE", `Frame of ${payload.byteLength} bytes exceeds the ${maxFrameBytes} byte limit`);
  }
  const header = Buffer.allocUnsafe(FRAME_HEADER_BYTES);
  header.writeUInt32LE(payload.byteLength, 0);
  return Buffer.concat([header, Buffer.from(payload)]);
}
function encodeJsonFrame(value, maxFrameBytes = MAX_FRAME_BYTES) {
  return encodeFrame(Buffer.from(JSON.stringify(value), "utf8"), maxFrameBytes);
}
function decodeJsonFrame(payload) {
  const text = Buffer.from(payload).toString("utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new FrameError("FRAME_INVALID", `Frame payload is not valid JSON: ${error.message}`);
  }
}
var FrameDecoder = class {
  #maxFrameBytes;
  #buffered = Buffer.alloc(0);
  constructor(maxFrameBytes = MAX_FRAME_BYTES) {
    this.#maxFrameBytes = maxFrameBytes;
  }
  /** Bytes held back waiting for the rest of their frame. */
  get pendingBytes() {
    return this.#buffered.byteLength;
  }
  /**
   * Add a chunk and take out every frame that is now complete.
   *
   * @throws {FrameError} when a declared length exceeds the configured limit.
   *   The caller must drop the connection: once a length is untrustworthy we
   *   can no longer find where the next frame starts.
   */
  push(chunk) {
    this.#buffered = this.#buffered.byteLength === 0 ? Buffer.from(chunk) : Buffer.concat([this.#buffered, Buffer.from(chunk)]);
    const frames = [];
    let offset = 0;
    while (this.#buffered.byteLength - offset >= FRAME_HEADER_BYTES) {
      const length = this.#buffered.readUInt32LE(offset);
      if (length > this.#maxFrameBytes) {
        throw new FrameError("FRAME_TOO_LARGE", `Declared frame length ${length} exceeds the ${this.#maxFrameBytes} byte limit`);
      }
      const frameEnd = offset + FRAME_HEADER_BYTES + length;
      if (this.#buffered.byteLength < frameEnd) {
        break;
      }
      frames.push(this.#buffered.subarray(offset + FRAME_HEADER_BYTES, frameEnd));
      offset = frameEnd;
    }
    this.#buffered = offset === 0 ? this.#buffered : this.#buffered.subarray(offset);
    return frames;
  }
  /** Drop any partial frame. Used when a connection is reset. */
  reset() {
    this.#buffered = Buffer.alloc(0);
  }
};

// build/protocol/handshake.mjs
import crypto from "node:crypto";

// build/protocol/types.mjs
var PROTOCOL_VERSION = 1;
function isHelperResponse(value) {
  if (value == null || typeof value !== "object") {
    return false;
  }
  const candidate = value;
  return typeof candidate.id === "number" && typeof candidate.ok === "boolean";
}

// build/protocol/handshake.mjs
var HandshakeError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "HandshakeError";
    this.code = code;
  }
};
function verifyHandshake(value, expectedToken) {
  if (value == null || typeof value !== "object") {
    throw new HandshakeError("MALFORMED", "Handshake frame is not an object");
  }
  const candidate = value;
  if (typeof candidate.token !== "string") {
    throw new HandshakeError("MALFORMED", "Handshake frame has no token string");
  }
  if (candidate.v !== PROTOCOL_VERSION) {
    throw new HandshakeError("VERSION_MISMATCH", `Helper speaks protocol ${String(candidate.v)}, server speaks ${PROTOCOL_VERSION}`);
  }
  if (!tokensMatch(candidate.token, expectedToken)) {
    throw new HandshakeError("TOKEN_MISMATCH", "Handshake token did not match");
  }
}
function tokensMatch(received, expected) {
  const receivedBytes = Buffer.from(received, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (receivedBytes.byteLength !== expectedBytes.byteLength) {
    return false;
  }
  return crypto.timingSafeEqual(receivedBytes, expectedBytes);
}

// build/server/helper-client.mjs
var DEFAULT_REQUEST_TIMEOUT_MS = 3e4;
var DEFAULT_HANDSHAKE_TIMEOUT_MS = 1e4;
var HelperClientError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "HelperClientError";
    this.code = code;
  }
};
var HelperClient = class {
  #options;
  #decoder = new FrameDecoder();
  #pending = /* @__PURE__ */ new Map();
  #socket;
  #nextId = 1;
  #verified = false;
  #closed = false;
  /** Set when a response frame announced binary data that has not arrived. */
  #binaryTarget;
  #handshakeResolve;
  #handshakeReject;
  constructor(options) {
    this.#options = {
      requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
      handshakeTimeoutMs: DEFAULT_HANDSHAKE_TIMEOUT_MS,
      ...options
    };
  }
  get connected() {
    return this.#verified && !this.#closed;
  }
  /**
   * Connect to the helper's pipe and wait for it to prove the shared token.
   *
   * Resolves only once the handshake has been verified, so a caller that
   * awaits this can assume any later `call` reaches the real helper.
   */
  async connect() {
    if (this.#socket) {
      throw new HelperClientError("INTERNAL", "Helper client is already connected");
    }
    const socket = net.createConnection({ path: this.#options.pipePath });
    this.#socket = socket;
    socket.on("data", (chunk) => this.#onData(chunk));
    socket.on("error", (error) => this.#failAll("HELPER_UNAVAILABLE", error.message));
    socket.on("close", () => this.#failAll("HELPER_UNAVAILABLE", "Helper pipe closed"));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        this.close();
        reject(new HelperClientError("HELPER_UNAVAILABLE", `Helper did not complete the handshake within ${this.#options.handshakeTimeoutMs}ms`));
      }, this.#options.handshakeTimeoutMs);
      const onVerified = () => {
        cleanup();
        resolve();
      };
      const onFailed = (error) => {
        cleanup();
        this.close();
        reject(error);
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.#handshakeResolve = void 0;
        this.#handshakeReject = void 0;
      };
      this.#handshakeResolve = onVerified;
      this.#handshakeReject = onFailed;
      socket.once("error", (error) => onFailed(new HelperClientError("HELPER_UNAVAILABLE", error.message)));
    });
  }
  /** Send one operation and wait for its response. */
  async call(op, args = {}, options = {}) {
    if (!this.connected || !this.#socket) {
      throw new HelperClientError("HELPER_UNAVAILABLE", "Helper is not connected");
    }
    const id = this.#nextId++;
    const socket = this.#socket;
    if (options.signal?.aborted)
      throw new HelperClientError("CANCELLED", "Operation cancelled before dispatch");
    const timeoutMs = options.timeoutMs ?? this.#options.requestTimeoutMs;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#failAll("HELPER_UNAVAILABLE", `Helper did not answer ${op} within ${timeoutMs}ms`);
        this.close();
      }, timeoutMs);
      const onAbort = () => {
        this.#failAll("CANCELLED", `Cancelled ${op}`);
        this.close();
      };
      const detachAbort = () => options.signal?.removeEventListener("abort", onAbort);
      this.#pending.set(id, { resolve, reject, timer, detachAbort });
      options.signal?.addEventListener("abort", onAbort, { once: true });
      socket.write(encodeJsonFrame({ id, op, args, ...options.timeoutMs !== void 0 ? { timeoutMs } : {} }));
    });
  }
  close() {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#socket?.destroy();
    this.#socket = void 0;
    this.#failAll("HELPER_UNAVAILABLE", "Helper client closed");
  }
  #onData(chunk) {
    let frames;
    try {
      frames = this.#decoder.push(chunk);
    } catch (error) {
      this.#rejectHandshake(error);
      this.#failAll("INTERNAL", error.message);
      this.close();
      return;
    }
    for (const frame of frames) {
      this.#onFrame(frame);
    }
  }
  #onFrame(frame) {
    if (this.#binaryTarget) {
      const target = this.#binaryTarget;
      this.#binaryTarget = void 0;
      const pending = this.#pending.get(target.id);
      this.#pending.delete(target.id);
      if (pending) {
        clearTimeout(pending.timer);
        pending.detachAbort?.();
        pending.resolve({
          result: pending.awaitingBinary?.result,
          binary: Buffer.from(frame)
        });
      }
      return;
    }
    let message;
    try {
      message = decodeJsonFrame(frame);
    } catch (error) {
      this.#rejectHandshake(error);
      this.#failAll("INTERNAL", error.message);
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
  #onHandshakeFrame(message) {
    try {
      verifyHandshake(message, this.#options.token);
    } catch (error) {
      this.#rejectHandshake(new HelperClientError("HELPER_UNAVAILABLE", error.message));
      this.close();
      return;
    }
    this.#verified = true;
    this.#handshakeResolve?.();
  }
  #onResponse(message) {
    const pending = this.#pending.get(message.id);
    if (!pending) {
      return;
    }
    if (!message.ok) {
      this.#pending.delete(message.id);
      clearTimeout(pending.timer);
      pending.detachAbort?.();
      pending.reject(toHelperClientError(message.error));
      return;
    }
    if (message.binary) {
      pending.awaitingBinary = {
        byteLength: message.binary.byteLength,
        result: message.result
      };
      this.#binaryTarget = { id: message.id, byteLength: message.binary.byteLength };
      return;
    }
    this.#pending.delete(message.id);
    clearTimeout(pending.timer);
    pending.detachAbort?.();
    pending.resolve({ result: message.result });
  }
  #rejectHandshake(error) {
    this.#handshakeReject?.(error);
  }
  #failAll(code, message) {
    for (const [id, pending] of this.#pending) {
      this.#pending.delete(id);
      clearTimeout(pending.timer);
      pending.detachAbort?.();
      pending.reject(new HelperClientError(code, message));
    }
  }
};
function toHelperClientError(error) {
  return new HelperClientError(error.code, error.message);
}

// build/server/helper-process.mjs
var CONNECT_ATTEMPTS = 60;
var CONNECT_RETRY_MS = 50;
var runFile = promisify(execFile);
function stalenessNotice(installed) {
  try {
    const bundled = bundledHelperPath();
    if (!bundled) {
      return void 0;
    }
    const shipped = readBuildId(path.join(path.dirname(bundled), "build-id.txt"));
    const running = readBuildId(path.join(path.dirname(installed), "build-id.txt"));
    if (!shipped || !running || shipped === running) {
      return void 0;
    }
    return "The installed elevated helper was built from different code than the one shipped with this plugin, so elevated sessions may be running outdated code. Re-run scripts/install-elevated-helper.ps1 from an elevated PowerShell to update it.";
  } catch {
    return void 0;
  }
}
function readBuildId(file) {
  try {
    const id = fs.readFileSync(file, "utf8").trim();
    return id.length > 0 ? id : void 0;
  } catch {
    return void 0;
  }
}
function installedHelperPath() {
  const programFiles = process.env.ProgramFiles ?? "C:/Program Files";
  const root = path.join(programFiles, "Computer Custom"), pointer = path.join(root, "active.json");
  if (fs.existsSync(pointer)) {
    const active = JSON.parse(fs.readFileSync(pointer, "utf8"));
    if (active.schema !== 1 || !/^versions\/[a-f0-9]{16}-[a-f0-9]{8}$/.test(active.directory ?? ""))
      throw new HelperClientError("HELPER_UNAVAILABLE", "Invalid installed helper version pointer. Reinstall the helper.");
    const executable = path.join(root, active.directory, "computer-custom-helper.exe");
    if (!fs.existsSync(executable))
      throw new HelperClientError("HELPER_UNAVAILABLE", "The active installed helper version is incomplete. Reinstall the helper.");
    return executable;
  }
  return path.join(root, "computer-custom-helper.exe");
}
function sessionFilePath() {
  const base = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  return path.join(base, "computer-custom", `session-${crypto2.randomUUID()}.json`);
}
var HelperProcess = class {
  #stoppedPids = /* @__PURE__ */ new Set();
  #options;
  #child;
  #client;
  #starting;
  #lastStderr = "";
  #startInfo;
  #elevatedPid;
  #generation = 0;
  #connecting;
  constructor(options = {}) {
    this.#options = options;
  }
  get running() {
    return this.#client?.connected === true;
  }
  /** How the current helper was started. Undefined until one is running. */
  get startInfo() {
    return this.#startInfo;
  }
  async call(op, args = {}, options = {}) {
    if (options.signal?.aborted)
      throw new HelperClientError("CANCELLED", "Operation cancelled");
    const generation = this.#generation;
    const started = performance.now();
    let rejectCancelled;
    const cancelled = new Promise((_, reject) => {
      rejectCancelled = reject;
    });
    const cancel = (code, message) => {
      rejectCancelled(new HelperClientError(code, message));
      if (generation === this.#generation)
        this.stop();
    };
    const onAbort = () => cancel("CANCELLED", "Operation cancelled");
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = options.timeoutMs === void 0 ? void 0 : setTimeout(() => cancel("HELPER_UNAVAILABLE", `Helper did not answer ${op} within ${options.timeoutMs}ms including startup`), options.timeoutMs);
    try {
      const client = await Promise.race([this.#ensureStarted(), cancelled]);
      const timeoutMs = options.timeoutMs === void 0 ? void 0 : Math.max(1, Math.ceil(options.timeoutMs - (performance.now() - started)));
      return await Promise.race([client.call(op, args, { ...options, timeoutMs }), cancelled]);
    } catch (error) {
      if (generation === this.#generation && error instanceof HelperClientError && (error.code === "HELPER_UNAVAILABLE" || error.code === "CANCELLED")) {
        this.stop();
      }
      throw error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }
  }
  stop() {
    const stoppedPid = this.#child?.pid ?? this.#elevatedPid;
    if (stoppedPid)
      this.#stoppedPids.add(stoppedPid);
    this.#generation++;
    this.#startInfo = void 0;
    this.#client?.close();
    this.#client = void 0;
    this.#connecting?.close();
    this.#connecting = void 0;
    this.#starting = void 0;
    this.#child?.kill();
    this.#child = void 0;
    if (this.#elevatedPid !== void 0) {
      try {
        process.kill(this.#elevatedPid);
      } catch {
      }
      this.#elevatedPid = void 0;
    }
  }
  /** Pipe closure initiates release; do not hand ownership on before native exit. */
  async waitForStop(timeoutMs = 1e3) {
    const until = performance.now() + timeoutMs;
    while (this.#stoppedPids.size) {
      for (const pid of this.#stoppedPids) {
        try {
          process.kill(pid, 0);
        } catch (error) {
          if (error.code === "ESRCH")
            this.#stoppedPids.delete(pid);
          else if (error.code !== "EPERM")
            throw error;
        }
      }
      if (!this.#stoppedPids.size)
        return;
      if (performance.now() >= until)
        throw new HelperClientError("HELPER_UNAVAILABLE", "Previous input worker has not exited; input ownership is not yet released.");
      await delay(5);
    }
  }
  #ensureStarted() {
    if (this.#client?.connected) {
      return Promise.resolve(this.#client);
    }
    if (!this.#starting) {
      const starting = this.#start(this.#generation);
      this.#starting = starting;
      void starting.finally(() => {
        if (this.#starting === starting)
          this.#starting = void 0;
      }).catch(() => {
      });
    }
    return this.#starting;
  }
  async #start(generation) {
    const token = crypto2.randomBytes(32).toString("hex");
    const pipeName = `computer-custom.${crypto2.randomUUID()}`;
    const pipePath = `\\\\.\\pipe\\${pipeName}`;
    if (this.#wantsElevated()) {
      const elevated = await this.#startElevated(pipeName, token, pipePath, generation);
      if (elevated) {
        return elevated;
      }
    }
    const executable = this.#options.executablePath ?? resolveHelperPath();
    if (generation !== this.#generation)
      throw new HelperClientError("CANCELLED", "Helper startup cancelled");
    const child = spawn(executable, ["--pipe", pipeName, "--parent", String(process.pid)], {
      stdio: ["pipe", "ignore", "pipe"],
      windowsHide: true
    });
    this.#child = child;
    child.stderr?.on("data", (chunk) => {
      this.#lastStderr = chunk.toString().trim();
    });
    const exited = new Promise((_resolve, reject) => {
      child.once("error", (error) => reject(new HelperClientError("HELPER_UNAVAILABLE", `Could not start the helper: ${error.message}`)));
      child.once("exit", (code) => reject(new HelperClientError("HELPER_UNAVAILABLE", `The helper exited with code ${code ?? "unknown"}${this.#lastStderr ? `: ${this.#lastStderr}` : ""}`)));
    });
    child.stdin?.write(`${token}
`);
    let client;
    try {
      client = await Promise.race([this.#connect(pipePath, token, generation), exited]);
    } catch (error) {
      child.kill();
      throw error;
    }
    if (generation !== this.#generation) {
      client.close();
      child.kill();
      throw new HelperClientError("CANCELLED", "Helper startup cancelled");
    }
    this.#client = client;
    this.#startInfo = {
      requested: this.#wantsElevated() ? "elevated" : "normal",
      actual: "normal",
      ...this.#wantsElevated() ? {
        notice: `Elevated start was requested but the signed helper is not installed at ${installedHelperPath()}, so this session runs at normal privilege and cannot drive elevated windows. Run scripts/install-elevated-helper.ps1 from an elevated PowerShell to set it up.`
      } : {}
    };
    return client;
  }
  /**
   * Starts the installed, signed helper so it runs with UIAccess.
   *
   * It must be launched through **ShellExecute**, not CreateProcess. Only the
   * AppInfo service can hand out a UIAccess token, and CreateProcess does not
   * ask it: `spawn` on a uiAccess binary fails outright with EACCES, and a
   * scheduled task — which launches the same way — fails with
   * ERROR_ELEVATION_REQUIRED. PowerShell's Start-Process, with no redirection
   * and no -NoNewWindow, uses ShellExecute and works. No UAC prompt appears;
   * granting UIAccess to a signed binary in a protected folder is exactly what
   * the mechanism is for.
   *
   * Returns undefined when the signed helper is not installed, so the caller
   * can fall back to a normal start.
   */
  async #startElevated(pipeName, token, pipePath, generation) {
    const installed = this.#options.installedExecutablePath ?? installedHelperPath();
    if (!fs.existsSync(installed)) {
      return void 0;
    }
    const sessionFile = sessionFilePath();
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    fs.writeFileSync(sessionFile, JSON.stringify({ pipeName, token }), "utf8");
    try {
      const launched = await runFile("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Start-Process -PassThru -WindowStyle Hidden -FilePath ${quoteForPowerShell(installed)} -ArgumentList '--session-file',${quoteForPowerShell('"' + sessionFile + '"')},'--parent','${process.pid}').Id`
      ], { windowsHide: true, encoding: "utf8", timeout: 1e4 });
      const pid = Number(launched.stdout.trim());
      if (generation !== this.#generation) {
        try {
          process.kill(pid);
        } catch {
        }
        throw new HelperClientError("CANCELLED", "Helper startup cancelled");
      }
      this.#elevatedPid = pid;
      if (!Number.isSafeInteger(this.#elevatedPid) || this.#elevatedPid <= 0) {
        this.#elevatedPid = void 0;
        throw new Error("ShellExecute returned no helper process id");
      }
    } catch (error) {
      fs.rmSync(sessionFile, { force: true });
      if (error instanceof HelperClientError)
        throw error;
      throw new HelperClientError("HELPER_UNAVAILABLE", `Could not start the elevated helper: ${error.message}`);
    }
    try {
      const client = await this.#connect(pipePath, token, generation);
      this.#client = client;
      const stale = stalenessNotice(installed);
      this.#startInfo = {
        requested: "elevated",
        actual: "elevated",
        ...stale ? { notice: stale } : {}
      };
      return client;
    } catch (error) {
      fs.rmSync(sessionFile, { force: true });
      throw error;
    }
  }
  async #connect(pipePath, token, generation) {
    let lastError;
    const deadline = performance.now() + 3e3;
    for (let attempt = 0; attempt < CONNECT_ATTEMPTS; attempt++) {
      if (generation !== this.#generation)
        throw new HelperClientError("CANCELLED", "Helper startup cancelled");
      const remaining = deadline - performance.now();
      if (remaining <= 0)
        break;
      const client = new HelperClient({ pipePath, token, handshakeTimeoutMs: Math.min(500, Math.ceil(remaining)) });
      this.#connecting = client;
      try {
        await client.connect();
        if (generation !== this.#generation) {
          client.close();
          throw new HelperClientError("CANCELLED", "Helper startup cancelled");
        }
        return client;
      } catch (error) {
        client.close();
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, CONNECT_RETRY_MS));
      } finally {
        if (this.#connecting === client)
          this.#connecting = void 0;
      }
    }
    throw lastError instanceof Error ? lastError : new HelperClientError("HELPER_UNAVAILABLE", "Could not reach the helper");
  }
  #wantsElevated() {
    return this.#options.elevated ?? wantsElevated();
  }
};
function bundledHelperPath() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "..", "helper", "computer-custom-helper.exe"),
    path.resolve(here, "..", "..", "helper", "computer-custom-helper.exe"),
    path.resolve(here, "..", "..", "dist", "computer-custom", "helper", "computer-custom-helper.exe")
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}
function wantsElevated() {
  const value = process.env.COMPUTER_CUSTOM_ELEVATED;
  return value !== "0" && value?.toLowerCase() !== "false";
}
function quoteForPowerShell(value) {
  return `'${value.replaceAll("'", "''")}'`;
}
function resolveHelperPath() {
  const override = process.env.COMPUTER_CUSTOM_HELPER;
  if (override) {
    if (!fs.existsSync(override)) {
      throw new HelperClientError("HELPER_UNAVAILABLE", `COMPUTER_CUSTOM_HELPER points at a file that does not exist: ${override}`);
    }
    return override;
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // Packaged plugin layout: scripts/ and helper/ side by side.
    path.resolve(here, "..", "helper", "computer-custom-helper.exe"),
    path.resolve(here, "..", "..", "helper", "computer-custom-helper.exe"),
    // Development layout, straight out of `dotnet build`.
    path.resolve(here, "..", "..", "dist", "computer-custom", "helper", "computer-custom-helper.exe"),
    path.resolve(here, "..", "..", "helper", "ComputerCustom.Helper", "bin", "Debug", "net10.0-windows10.0.19041.0", "computer-custom-helper.exe")
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new HelperClientError("HELPER_UNAVAILABLE", `Could not find the helper executable. Looked in:
${candidates.join("\n")}
Set COMPUTER_CUSTOM_HELPER to its path, or build it with: dotnet build helper/ComputerCustom.Helper`);
}

// build/server/helper-check.mjs
import path2 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
async function checkProtectedHelper(helper) {
  const started = performance.now();
  try {
    let answer;
    try {
      answer = await helper.call("ping", {}, { timeoutMs: 5e3 });
    } catch (error) {
      if (error.code !== "HELPER_UNAVAILABLE")
        throw error;
      helper.stop();
      await helper.waitForStop();
      answer = await helper.call("ping", {}, { timeoutMs: 5e3 });
    }
    const result = answer.result;
    if (!result.uiAccess || !result.capabilities?.preparedInput)
      throw new Error("The protected helper did not receive UIAccess/prepared-input capability.");
    return { uiAccess: true, preparedInput: true, startupMs: performance.now() - started };
  } finally {
    helper.stop();
    await helper.waitForStop();
  }
}
if (process.argv[1] && path2.resolve(process.argv[1]) === fileURLToPath2(import.meta.url)) {
  try {
    const executable = process.argv[2];
    if (!executable)
      throw new Error("Pass the protected helper executable to verify.");
    const result = await checkProtectedHelper(new HelperProcess({ elevated: true, installedExecutablePath: executable }));
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch (error) {
    const failure = error;
    process.stderr.write(JSON.stringify({ ok: false, code: failure.code ?? "STARTUP_FAILED", message: failure.message, stack: failure.stack }) + "\n");
    process.exitCode = 1;
  }
}
export {
  checkProtectedHelper
};
