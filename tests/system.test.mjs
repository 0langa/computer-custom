import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  deletePath,
  describeDeleteTarget,
  readTextFile,
  runShell,
  writeTextFile,
} from "../build/server/system.mjs";

const directories = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

function tempDir() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-system-"));
  directories.push(directory);
  return directory;
}

describe("run_shell", () => {
  it("returns output and a zero exit code", async () => {
    const result = await runShell({ command: "Write-Output hello-from-flow" });

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /hello-from-flow/);
    assert.equal(result.timedOut, false);
  });

  it("reports a non-zero exit code rather than throwing", async () => {
    const result = await runShell({ command: "exit 3" });

    assert.notEqual(result.exitCode, 0);
  });

  it("runs in the requested directory", async () => {
    const directory = tempDir();

    const result = await runShell({ command: "(Get-Location).Path", cwd: directory });

    assert.match(result.stdout.toLowerCase(), new RegExp(escapeRegex(path.basename(directory).toLowerCase())));
  });

  it("refuses a working directory that does not exist", async () => {
    await assert.rejects(
      runShell({ command: "Write-Output x", cwd: path.join(os.tmpdir(), "cc-not-here-xyz") }),
      /Working directory does not exist/,
    );
  });

  it("kills a command that overruns its timeout", async () => {
    const result = await runShell({ command: "Start-Sleep -Seconds 30", timeoutMs: 1500 });

    assert.equal(result.timedOut, true);
    assert.match(result.stderr, /Timed out/);
  });
});

describe("file tools", () => {
  it("writes, reads back, then appends", async () => {
    const file = path.join(tempDir(), "nested", "note.txt");

    const written = await writeTextFile(file, "first line\n", false);
    assert.equal(written.bytes, 11);

    assert.equal((await readTextFile(file)).content, "first line\n");

    await writeTextFile(file, "second line\n", true);
    assert.equal((await readTextFile(file)).content, "first line\nsecond line\n");
  });

  it("reports truncation instead of silently shortening", async () => {
    const file = path.join(tempDir(), "big.txt");
    await writeTextFile(file, "x".repeat(500), false);

    const result = await readTextFile(file, 100);

    assert.equal(result.content.length, 100);
    assert.equal(result.bytes, 500);
    assert.equal(result.truncated, true);
  });

  it("lists a directory's entries", async () => {
    const directory = tempDir();
    await writeTextFile(path.join(directory, "a.txt"), "a", false);
    fs.mkdirSync(path.join(directory, "sub"));

    const result = await readTextFile(directory);

    assert.match(result.content, /file\s+a\.txt/);
    assert.match(result.content, /dir\s+sub/);
  });

  it("fails clearly on a missing file", async () => {
    await assert.rejects(readTextFile(path.join(tempDir(), "absent.txt")), /No such file/);
  });
});

describe("deleting", () => {
  it("removes a file", async () => {
    const file = path.join(tempDir(), "gone.txt");
    await writeTextFile(file, "bye", false);

    const result = await deletePath(file, false);

    assert.equal(result.kind, "file");
    assert.equal(fs.existsSync(file), false);
  });

  it("refuses a non-empty directory unless recursive is set", async () => {
    // Deleting a tree must be an explicit choice, never a side effect of
    // pointing at a folder.
    const directory = tempDir();
    const nested = path.join(directory, "keep");
    fs.mkdirSync(nested);
    await writeTextFile(path.join(nested, "important.txt"), "data", false);

    await assert.rejects(deletePath(nested, false), /Pass recursive: true/);
    assert.equal(fs.existsSync(nested), true);

    const result = await deletePath(nested, true);
    assert.equal(result.kind, "directory");
    assert.equal(fs.existsSync(nested), false);
  });

  it("describes what a delete would actually remove", async () => {
    const directory = tempDir();
    await writeTextFile(path.join(directory, "one.txt"), "1", false);
    await writeTextFile(path.join(directory, "two.txt"), "2", false);

    const description = await describeDeleteTarget(directory);

    assert.match(description, /directory/);
    assert.match(description, /2 entries/);
  });

  it("says so when the path is not there", async () => {
    const missing = path.join(tempDir(), "nope");

    assert.match(await describeDeleteTarget(missing), /does not exist/);
    await assert.rejects(deletePath(missing, false), /No such path/);
  });
});

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
