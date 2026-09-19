import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const blocked = [
  new RegExp("Ju" + "lius", "i"),
  new RegExp("C:" + "\\\\" + "Users", "i"),
  new RegExp("\\.codex" + "\\\\" + "plugins" + "\\\\" + "cache", "i"),
];
const ignoredDirs = new Set([
  ".git",
  // Local project memory. Git-ignored, so it never reaches the public repo,
  // but it does hold machine paths and would fail every local run of this scan.
  ".recall",
  "build",
  "node_modules",
  "upstream/openai-bundled",
]);
const findings = [];

for (const file of listFiles(repoRoot)) {
  const relative = path.relative(repoRoot, file).replaceAll("\\", "/");
  if (isIgnored(relative)) {
    continue;
  }
  const text = fs.readFileSync(file, "utf8");
  for (const pattern of blocked) {
    if (pattern.test(text)) {
      findings.push(`${relative}: ${pattern}`);
    }
  }
}

if (findings.length > 0) {
  console.error(findings.join("\n"));
  process.exitCode = 1;
}

function* listFiles(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* listFiles(fullPath);
      continue;
    }
    if (entry.isFile()) {
      yield fullPath;
    }
  }
}

function isIgnored(relative) {
  if ([...ignoredDirs].some((dir) => relative === dir || relative.startsWith(`${dir}/`))) {
    return true;
  }

  // Compiler output anywhere in the tree. The .NET helper writes absolute
  // machine paths into its bin/ and obj/ artefacts, and those are git-ignored,
  // so scanning them only ever produces false alarms.
  return relative.split("/").some((segment) => segment === "bin" || segment === "obj");
}
