/**
 * Starting the native helper and keeping a connection to it.
 *
 * The helper is launched lazily, on the first operation that needs it, so a
 * session that never touches the screen never spawns a process.
 */

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HelperClient,
  HelperClientError,
  type HelperCallResult,
} from "./helper-client.mjs";
import type { HelperOp } from "../protocol/types.mjs";

/**
 * The helper creates its pipe only after reading the token from stdin, so the
 * first connection attempts lose a race it is expected to lose.
 */
const CONNECT_ATTEMPTS = 60;
const CONNECT_RETRY_MS = 50;

export type HelperProcessOptions = {
  /** Explicit path to the helper executable. Overrides discovery. */
  executablePath?: string | undefined;
};

/** How the running helper was started, and anything the user should know. */
export type HelperStartInfo = {
  requested: "normal" | "elevated";
  actual: "normal" | "elevated";
  notice?: string;
};

/**
 * Warns when the installed elevated helper is older than the one shipped with
 * this plugin.
 *
 * The installed copy is built and signed separately by the install script, so
 * a plugin update does not touch it. Without this check the elevated path
 * silently keeps running whatever code was installed months ago, and a fix
 * appears to have no effect for no visible reason.
 *
 * Compares modification times rather than contents: the two binaries differ by
 * design, because only the installed one carries the uiAccess manifest and a
 * signature.
 */
function stalenessNotice(installed: string): string | undefined {
  try {
    const bundled = bundledHelperPath();
    if (!bundled || !fs.existsSync(bundled)) {
      return undefined;
    }

    if (fs.statSync(bundled).mtimeMs <= fs.statSync(installed).mtimeMs) {
      return undefined;
    }

    return (
      "The installed elevated helper is older than the one shipped with this plugin, " +
      "so elevated sessions are running outdated code. Re-run " +
      "scripts/install-elevated-helper.ps1 from an elevated PowerShell to update it."
    );
  } catch {
    // A missing or unreadable file is not worth failing a session over.
    return undefined;
  }
}

/** Where scripts/install-elevated-helper.ps1 puts the signed helper. */
function installedHelperPath(): string {
  const programFiles = process.env.ProgramFiles ?? "C:\Program Files";
  return path.join(programFiles, "Computer Custom", "computer-custom-helper.exe");
}

/**
 * Where the server leaves the pipe name and token for an elevated helper.
 *
 * A scheduled task gets no stdin and its arguments are fixed when it is
 * registered, so per-run values have to be left somewhere both sides agree on.
 * LocalAppData is the user's own directory. The helper deletes the file as soon
 * as it has read it, so the token is on disk for milliseconds.
 *
 * This is weaker than the stdin route used for a normal start, and it is the
 * reason elevated mode is opt-in rather than the default.
 */
function sessionFilePath(): string {
  const base =
    process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  return path.join(base, "computer-custom", "session.json");
}

export class HelperProcess {
  readonly #options: HelperProcessOptions;
  #child: ChildProcess | undefined;
  #client: HelperClient | undefined;
  #starting: Promise<HelperClient> | undefined;
  #lastStderr = "";
  #startInfo: HelperStartInfo | undefined;

  constructor(options: HelperProcessOptions = {}) {
    this.#options = options;
  }

  get running(): boolean {
    return this.#client?.connected === true;
  }

  /** How the current helper was started. Undefined until one is running. */
  get startInfo(): HelperStartInfo | undefined {
    return this.#startInfo;
  }

  async call(op: HelperOp, args: Record<string, unknown> = {}): Promise<HelperCallResult> {
    const client = await this.#ensureStarted();
    try {
      return await client.call(op, args);
    } catch (error) {
      if (error instanceof HelperClientError && error.code === "HELPER_UNAVAILABLE") {
        // The helper died. Drop it so the next call starts a fresh one rather
        // than failing forever against a corpse.
        this.stop();
      }

      throw error;
    }
  }

  stop(): void {
    this.#startInfo = undefined;
    this.#client?.close();
    this.#client = undefined;
    this.#starting = undefined;
    this.#child?.kill();
    this.#child = undefined;
  }

  #ensureStarted(): Promise<HelperClient> {
    if (this.#client?.connected) {
      return Promise.resolve(this.#client);
    }

    // Concurrent tool calls must not each spawn a helper.
    this.#starting ??= this.#start().finally(() => {
      this.#starting = undefined;
    });

    return this.#starting;
  }

  async #start(): Promise<HelperClient> {
    const token = crypto.randomBytes(32).toString("hex");
    const pipeName = `computer-custom.${crypto.randomUUID()}`;
    const pipePath = `\\\\.\\pipe\\${pipeName}`;

    if (wantsElevated()) {
      const elevated = await this.#startElevated(pipeName, token, pipePath);
      if (elevated) {
        return elevated;
      }
    }

    // Either elevation was not asked for, or the task is not installed. Fall
    // back to a normal-privilege helper and say so in startInfo, rather than
    // failing outright or pretending the helper can reach elevated windows.
    const executable = this.#options.executablePath ?? resolveHelperPath();

    const child = spawn(executable, ["--pipe", pipeName], {
      stdio: ["pipe", "ignore", "pipe"],
      windowsHide: true,
    });
    this.#child = child;

    child.stderr?.on("data", (chunk: Buffer) => {
      this.#lastStderr = chunk.toString().trim();
    });

    const exited = new Promise<never>((_resolve, reject) => {
      child.once("error", (error) =>
        reject(new HelperClientError("HELPER_UNAVAILABLE", `Could not start the helper: ${error.message}`)),
      );
      child.once("exit", (code) =>
        reject(
          new HelperClientError(
            "HELPER_UNAVAILABLE",
            `The helper exited with code ${code ?? "unknown"}${this.#lastStderr ? `: ${this.#lastStderr}` : ""}`,
          ),
        ),
      );
    });

    // The token goes over stdin so it never appears in the command line, which
    // other processes on this machine can read.
    child.stdin?.write(`${token}\n`);

    const client = await Promise.race([this.#connect(pipePath, token), exited]);
    this.#client = client;
    this.#startInfo = {
      requested: wantsElevated() ? "elevated" : "normal",
      actual: "normal",
      ...(wantsElevated()
        ? {
            notice:
              "Elevated start was requested but the signed helper is not installed at " +
              `${installedHelperPath()}, so this session runs at normal privilege and cannot drive ` +
              "elevated windows. Run scripts/install-elevated-helper.ps1 from an elevated PowerShell to set it up.",
          }
        : {}),
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
  async #startElevated(
    pipeName: string,
    token: string,
    pipePath: string,
  ): Promise<HelperClient | undefined> {
    const installed = installedHelperPath();
    if (!fs.existsSync(installed)) {
      return undefined;
    }

    const sessionFile = sessionFilePath();
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    fs.writeFileSync(sessionFile, JSON.stringify({ pipeName, token }), "utf8");

    try {
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Start-Process -WindowStyle Hidden -FilePath ${quoteForPowerShell(installed)} -ArgumentList '--session-file',${quoteForPowerShell(sessionFile)}`,
        ],
        { stdio: "ignore", windowsHide: true },
      );
    } catch (error) {
      // Leaving a token file behind would be careless.
      fs.rmSync(sessionFile, { force: true });
      throw new HelperClientError(
        "HELPER_UNAVAILABLE",
        `Could not start the elevated helper: ${(error as Error).message}`,
      );
    }

    try {
      const client = await this.#connect(pipePath, token);
      this.#client = client;
      const stale = stalenessNotice(installed);
      this.#startInfo = {
        requested: "elevated",
        actual: "elevated",
        ...(stale ? { notice: stale } : {}),
      };
      return client;
    } catch (error) {
      fs.rmSync(sessionFile, { force: true });
      throw error;
    }
  }

  async #connect(pipePath: string, token: string): Promise<HelperClient> {
    let lastError: unknown;

    for (let attempt = 0; attempt < CONNECT_ATTEMPTS; attempt++) {
      const client = new HelperClient({ pipePath, token });
      try {
        await client.connect();
        return client;
      } catch (error) {
        client.close();
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, CONNECT_RETRY_MS));
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new HelperClientError("HELPER_UNAVAILABLE", "Could not reach the helper");
  }
}

/** The non-uiAccess helper that ships with the plugin, if it can be found. */
function bundledHelperPath(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "..", "helper", "computer-custom-helper.exe"),
    path.resolve(here, "..", "..", "helper", "computer-custom-helper.exe"),
    path.resolve(
      here,
      "..",
      "..",
      "dist",
      "computer-custom",
      "helper",
      "computer-custom-helper.exe",
    ),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate));
}

/**
 * Elevated mode is opt-OUT.
 *
 * This plugin is invoked deliberately, by someone who wants more reach than
 * the ordinary computer-use tools give them; anything less and they would use
 * those instead. Defaulting to the weaker mode would mean the common case is
 * the one that silently cannot do the job.
 *
 * It costs nothing when unavailable: without the signed helper installed the
 * session falls back to normal privilege and says so. The session file is
 * written only on the elevated path, so the trade-off noted above applies only
 * when elevation is actually used.
 */
function wantsElevated(): boolean {
  const value = process.env.COMPUTER_CUSTOM_ELEVATED;
  return value !== "0" && value?.toLowerCase() !== "false";
}

/** PowerShell single-quoted string: the only escape inside one is a doubled quote. */
function quoteForPowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Finds the helper executable.
 *
 * Checked in order: an explicit environment override, the packaged location
 * next to the plugin, then the local build output used during development.
 */
export function resolveHelperPath(): string {
  const override = process.env.COMPUTER_CUSTOM_HELPER;
  if (override) {
    if (!fs.existsSync(override)) {
      throw new HelperClientError(
        "HELPER_UNAVAILABLE",
        `COMPUTER_CUSTOM_HELPER points at a file that does not exist: ${override}`,
      );
    }

    return override;
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const programFiles = process.env.ProgramFiles ?? "C:\Program Files";
  const candidates = [
    // The signed, installed copy, if the elevated setup has been run.
    path.join(programFiles, "Computer Custom", "computer-custom-helper.exe"),
    // Packaged plugin layout: scripts/ and helper/ side by side.
    path.resolve(here, "..", "helper", "computer-custom-helper.exe"),
    path.resolve(here, "..", "..", "helper", "computer-custom-helper.exe"),
    // Development layout, straight out of `dotnet build`.
    path.resolve(
      here,
      "..",
      "..",
      "helper",
      "ComputerCustom.Helper",
      "bin",
      "Debug",
      "net10.0-windows",
      "computer-custom-helper.exe",
    ),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new HelperClientError(
    "HELPER_UNAVAILABLE",
    `Could not find the helper executable. Looked in:\n${candidates.join("\n")}\nSet COMPUTER_CUSTOM_HELPER to its path, or build it with: dotnet build helper/ComputerCustom.Helper`,
  );
}
