/**
 * Shell and file operations.
 *
 * These run in the server process, not the helper. They need no synthetic
 * input, and keeping them here means they pass through the same policy engine
 * as every click and keystroke rather than growing a second set of rules.
 *
 * Typing into a terminal window with a fake keyboard would be slower, less
 * reliable, and would hand back pixels instead of output. Running the process
 * directly is simply better.
 */

import { type ExecFileOptions, execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

/** Beyond this, output is truncated rather than flooding the agent's context. */
export const MAX_OUTPUT_BYTES = 100_000;

/** Beyond this, a shell command is killed. */
export const DEFAULT_TIMEOUT_MS = 120_000;

export type ShellResult = {
  command: string;
  shell: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
};

export type ShellOptions = {
  command: string;
  cwd?: string | undefined;
  shell?: "powershell" | "cmd" | undefined;
  timeoutMs?: number | undefined;
};

export async function runShell(options: ShellOptions): Promise<ShellResult> {
  const shell = options.shell ?? "powershell";
  const cwd = options.cwd ?? process.cwd();
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  await assertDirectory(cwd);

  const [file, args] =
    shell === "cmd"
      ? ["cmd.exe", ["/d", "/s", "/c", options.command]]
      : [
          "powershell.exe",
          // -NoProfile keeps a user's profile from changing behaviour between
          // machines; -NonInteractive makes a command that wants input fail
          // fast instead of hanging until the timeout.
          ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", options.command],
        ];

  const execOptions: ExecFileOptions = {
    cwd,
    timeout,
    windowsHide: true,
    maxBuffer: MAX_OUTPUT_BYTES * 2,
  };

  return new Promise<ShellResult>((resolve) => {
    execFile(file, args, execOptions, (error, stdout, stderr) => {
      const out = String(stdout);
      const err = String(stderr);

      // Node reports a timeout by KILLING the child and setting `killed`, not
      // by setting code to ETIMEDOUT. Checking only the code meant a command
      // that ran away was reported as an ordinary failure, with no hint that
      // it had been cut short.
      const failure = error as (NodeJS.ErrnoException & { killed?: boolean }) | null;
      const timedOut =
        failure !== null && (failure.killed === true || failure.code === "ETIMEDOUT");

      resolve({
        command: options.command,
        shell,
        cwd,
        exitCode:
          failure === null ? 0 : typeof failure.code === "number" ? failure.code : null,
        stdout: clamp(out),
        stderr: clamp(timedOut ? `${err}\nTimed out after ${timeout}ms.` : err),
        truncated: out.length > MAX_OUTPUT_BYTES || err.length > MAX_OUTPUT_BYTES,
        timedOut,
      });
    });
  });
}

export type ReadResult = {
  path: string;
  content: string;
  bytes: number;
  truncated: boolean;
};

export async function readTextFile(filePath: string, maxBytes?: number): Promise<ReadResult> {
  const limit = maxBytes ?? MAX_OUTPUT_BYTES;
  const resolved = path.resolve(filePath);
  const stat = await fs.stat(resolved).catch(() => undefined);

  if (!stat) {
    throw new Error(`No such file: ${resolved}`);
  }

  if (stat.isDirectory()) {
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    return {
      path: resolved,
      content: entries
        .map((entry) => `${entry.isDirectory() ? "dir " : "file"}  ${entry.name}`)
        .join("\n"),
      bytes: 0,
      truncated: false,
    };
  }

  const handle = await fs.open(resolved, "r");
  try {
    const buffer = Buffer.alloc(Math.min(stat.size, limit));
    await handle.read(buffer, 0, buffer.byteLength, 0);
    return {
      path: resolved,
      content: buffer.toString("utf8"),
      bytes: stat.size,
      truncated: stat.size > buffer.byteLength,
    };
  } finally {
    await handle.close();
  }
}

export async function writeTextFile(
  filePath: string,
  content: string,
  append: boolean,
): Promise<{ path: string; bytes: number; append: boolean }> {
  const resolved = path.resolve(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });

  if (append) {
    await fs.appendFile(resolved, content, "utf8");
  } else {
    await fs.writeFile(resolved, content, "utf8");
  }

  return { path: resolved, bytes: Buffer.byteLength(content, "utf8"), append };
}

export type DeleteResult = {
  path: string;
  kind: "file" | "directory";
  entriesRemoved: number;
};

/**
 * Deletes a file or directory.
 *
 * A directory is refused unless `recursive` is set, and the count of what would
 * be removed is reported, so "delete this folder" cannot quietly take a tree
 * with it.
 */
export async function deletePath(targetPath: string, recursive: boolean): Promise<DeleteResult> {
  const resolved = path.resolve(targetPath);
  const stat = await fs.stat(resolved).catch(() => undefined);

  if (!stat) {
    throw new Error(`No such path: ${resolved}`);
  }

  if (stat.isDirectory()) {
    const entries = await fs.readdir(resolved);
    if (!recursive && entries.length > 0) {
      throw new Error(
        `${resolved} is a directory holding ${entries.length} entries. Pass recursive: true to remove it and everything inside.`,
      );
    }

    await fs.rm(resolved, { recursive: true, force: false });
    return { path: resolved, kind: "directory", entriesRemoved: entries.length };
  }

  await fs.rm(resolved, { force: false });
  return { path: resolved, kind: "file", entriesRemoved: 1 };
}

/** Counts what a recursive delete would remove, for the confirmation prompt. */
export async function describeDeleteTarget(targetPath: string): Promise<string> {
  const resolved = path.resolve(targetPath);
  const stat = await fs.stat(resolved).catch(() => undefined);

  if (!stat) {
    return `${resolved} (does not exist)`;
  }

  if (!stat.isDirectory()) {
    return `the file ${resolved} (${stat.size} bytes)`;
  }

  const entries = await fs.readdir(resolved).catch(() => []);
  return `the directory ${resolved} and its ${entries.length} entries`;
}

async function assertDirectory(candidate: string): Promise<void> {
  const stat = await fs.stat(candidate).catch(() => undefined);
  if (!stat?.isDirectory()) {
    throw new Error(`Working directory does not exist: ${candidate}`);
  }
}

function clamp(value: string): string {
  return value.length > MAX_OUTPUT_BYTES
    ? `${value.slice(0, MAX_OUTPUT_BYTES)}\n...[truncated]`
    : value;
}
