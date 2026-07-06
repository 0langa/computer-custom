import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(repoRoot, "dist", "computer-custom");

fs.rmSync(distRoot, { force: true, recursive: true });
fs.mkdirSync(path.join(distRoot, ".codex-plugin"), { recursive: true });
fs.mkdirSync(path.join(distRoot, ".claude-plugin"), { recursive: true });
fs.mkdirSync(path.join(distRoot, "config"), { recursive: true });
fs.mkdirSync(path.join(distRoot, "scripts"), { recursive: true });
fs.mkdirSync(path.join(distRoot, "hooks"), { recursive: true });
fs.mkdirSync(path.join(distRoot, "skills", "computer-custom"), {
  recursive: true,
});

copyFile(
  path.join(repoRoot, "overlay", "config", "default-policy.json"),
  path.join(distRoot, "config", "default-policy.json"),
);
copyFile(
  path.join(repoRoot, "overlay", "skills", "computer-custom", "SKILL.md"),
  path.join(distRoot, "skills", "computer-custom", "SKILL.md"),
);
copyFile(
  path.join(repoRoot, "build", "runtime.mjs"),
  path.join(distRoot, "scripts", "computer-custom-client.mjs"),
);
copyFile(
  path.join(repoRoot, "build", "policy.mjs"),
  path.join(distRoot, "scripts", "policy.mjs"),
);
copyFile(
  path.join(repoRoot, "overlay", "scripts", "computer-use-guard.mjs"),
  path.join(distRoot, "scripts", "computer-use-guard.mjs"),
);
copyFile(
  path.join(repoRoot, "overlay", "claude", "hooks", "claude-hooks.json"),
  path.join(distRoot, "hooks", "claude-hooks.json"),
);

writeJson(path.join(distRoot, ".codex-plugin", "plugin.json"), {
  name: "computer-custom",
  version: "0.1.0",
  description:
    "Policy-controlled Windows Computer Use wrapper for technical Codex users.",
  author: {
    name: "0langa",
    email: "plugins@0langa.dev",
    url: "https://github.com/0langa",
  },
  homepage: "https://github.com/0langa/computer-custom",
  repository: "https://github.com/0langa/computer-custom",
  license: "MIT",
  keywords: ["computer-use", "windows", "automation", "policy", "codex"],
  skills: "./skills/",
  interface: {
    displayName: "Computer Custom",
    shortDescription: "Policy-controlled Windows app automation.",
    longDescription:
      "Computer Custom wraps the locally installed OpenAI Computer Use runtime with configurable policy gates, exact-phrase confirmations, and redacted audit entries.",
    developerName: "0langa",
    category: "Developer Tools",
    capabilities: ["Interactive", "Read", "Write"],
    websiteURL: "https://github.com/0langa/computer-custom",
    privacyPolicyURL: "https://github.com/0langa/computer-custom#privacy",
    termsOfServiceURL: "https://github.com/0langa/computer-custom#terms",
    defaultPrompt: [
      "Inspect an app window safely",
      "Automate a Windows workflow with policy gates",
      "List targetable Windows apps",
    ],
    brandColor: "#0F766E",
    screenshots: [],
  },
});

writeJson(path.join(distRoot, ".claude-plugin", "plugin.json"), {
  name: "computer-custom",
  version: "0.1.0",
  description:
    "Policy-controlled guard for Claude Code's Computer Use tools.",
  author: {
    name: "0langa",
    email: "plugins@0langa.dev",
    url: "https://github.com/0langa",
  },
  homepage: "https://github.com/0langa/computer-custom",
  repository: "https://github.com/0langa/computer-custom",
  license: "MIT",
  keywords: ["computer-use", "windows", "automation", "policy", "claude-code"],
  skills: "./skills/",
  hooks: "./hooks/claude-hooks.json",
});

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function writeJson(to, value) {
  fs.writeFileSync(to, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
