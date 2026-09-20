#!/usr/bin/env node
/**
 * A stable identity for the helper's SOURCE, shared by every binary built from
 * it.
 *
 * The elevated helper in Program Files and the one shipped in the plugin are
 * never byte-identical: only the installed copy carries the uiAccess manifest
 * and an Authenticode signature. So "are these the same code?" cannot be
 * answered by comparing the files.
 *
 * It used to be answered by comparing modification times, which was wrong. A
 * plugin reinstall, a git checkout, or an unrelated rebuild all move the
 * bundled file's timestamp forward without changing a line of helper code, and
 * the user was then told every session to re-run an elevated installer for
 * nothing. Measured: the installed binary was NEWER than the last change to
 * helper source, and was still reported as out of date.
 *
 * Hashing the source settles it. Same id, same code, whatever was done to the
 * files afterwards.
 *
 * Run directly to print the id:  node scripts/helper-build-id.mjs
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HELPER_SRC = path.join(REPO_ROOT, "helper", "ComputerCustom.Helper");
const INCLUDED = new Set([".cs", ".csproj", ".manifest"]);

/** Every source file that can change the helper's behaviour, sorted. */
function sourceFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // Build output is a product of these sources, not an input to them.
    if (entry.isDirectory()) {
      if (entry.name === "bin" || entry.name === "obj") continue;
      found.push(...sourceFiles(path.join(dir, entry.name)));
    } else if (INCLUDED.has(path.extname(entry.name).toLowerCase())) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found.sort();
}

/**
 * Hashes the helper's source tree.
 *
 * Line endings are normalised: git may check the same file out as CRLF on one
 * machine and LF on another, and that must not look like a code change.
 */
export function helperBuildId(sourceDir = HELPER_SRC) {
  const hash = crypto.createHash("sha256");
  for (const file of sourceFiles(sourceDir)) {
    hash.update(path.relative(sourceDir, file).replace(/\\/g, "/"));
    hash.update("\0");
    hash.update(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(helperBuildId());
}
