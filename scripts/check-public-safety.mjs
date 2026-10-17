import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

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

// Scan what can actually enter the package/repository. Walking the whole
// directory included ignored test logs and visited node_modules before filtering.
const candidates=execFileSync('git',['-C',repoRoot,'ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8',windowsHide:true});
for (const relativeFile of new Set(candidates.split('\0').filter(Boolean))) {
  const file=path.join(repoRoot,relativeFile);
  if(!fs.existsSync(file)||!fs.statSync(file).isFile())continue;
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

function isIgnored(relative) {
  if ([...ignoredDirs].some((dir) => relative === dir || relative.startsWith(`${dir}/`))) {
    return true;
  }

  // Compiler output anywhere in the tree. The .NET helper writes absolute
  // machine paths into its bin/ and obj/ artefacts, and those are git-ignored,
  // so scanning them only ever produces false alarms.
  return relative.split("/").some((segment) => segment === "bin" || segment === "obj");
}
