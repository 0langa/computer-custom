import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import { helperBuildId } from "./helper-build-id.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(repoRoot, "dist", "computer-custom");
const packageMetadata = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
);

// Clear everything except the published helper. That comes from `dotnet
// publish`, not from this script, and wiping it here means any `npm test`
// silently guts the packaged plugin.
if (fs.existsSync(distRoot)) {
  for (const entry of fs.readdirSync(distRoot)) {
    if (entry === "helper") {
      continue;
    }

    fs.rmSync(path.join(distRoot, entry), { force: true, recursive: true });
  }
}
fs.mkdirSync(path.join(distRoot, ".codex-plugin"), { recursive: true });
fs.mkdirSync(path.join(distRoot, ".claude-plugin"), { recursive: true });
fs.mkdirSync(path.join(distRoot, "config"), { recursive: true });
fs.mkdirSync(path.join(distRoot, "scripts"), { recursive: true });
fs.mkdirSync(path.join(distRoot, "hooks"), { recursive: true });
fs.mkdirSync(path.join(distRoot, "assets"), { recursive: true });
fs.mkdirSync(path.join(distRoot, "skills", "computer-custom"), {
  recursive: true,
});
fs.mkdirSync(path.join(distRoot, "server"), { recursive: true });
fs.mkdirSync(path.join(distRoot, "flows"), { recursive: true });

// The MCP server ships as one bundled file with its dependencies inlined, so
// the installed plugin needs no npm install and no node_modules beside it.
esbuild.buildSync({
  entryPoints: [path.join(repoRoot, "build", "server", "index.mjs")],
  outfile: path.join(distRoot, "server", "index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // No shebang banner here: the entry module already carries one, and a second
  // would land on line 2, where it is a syntax error rather than a comment.
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
  path.join(repoRoot, "scripts", "install-elevated-helper.ps1"),
  path.join(distRoot, "scripts", "install-elevated-helper.ps1"),
);
copyFile(
  path.join(repoRoot, "scripts", "helper-build-id.mjs"),
  path.join(distRoot, "scripts", "helper-build-id.mjs"),
);

// Which helper source this plugin's binary was built from. The installer writes
// the same file beside the elevated copy, and the server compares the two to
// tell whether the elevated helper is really behind.
fs.mkdirSync(path.join(distRoot, "helper"), { recursive: true });
fs.writeFileSync(path.join(distRoot, "helper", "build-id.txt"), `${helperBuildId()}\n`, "utf8");
copyFile(
  path.join(repoRoot, "overlay", "claude", "hooks", "claude-hooks.json"),
  path.join(distRoot, "hooks", "claude-hooks.json"),
);
for (const flow of ["README.md", "window-report.mjs"]) {
  copyFile(path.join(repoRoot, "flows", flow), path.join(distRoot, "flows", flow));
}
for (const asset of ["icon.png", "logo.png", "screenshot-1.png"]) {
  copyFile(
    path.join(repoRoot, "overlay", "assets", asset),
    path.join(distRoot, "assets", asset),
  );
}

writeJson(path.join(distRoot, ".codex-plugin", "plugin.json"), {
  name: "computer-custom",
  version: packageMetadata.version,
  description:
    "Self-contained Windows computer control with policy gates. No other runtime required.",
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
  mcpServers: "./.codex-mcp.json",
  interface: {
    displayName: "Computer Custom",
    shortDescription: "Policy-controlled Windows app automation.",
    longDescription:
      "Computer Custom drives Windows directly through its own MCP server and native helper: screen, mouse, keyboard, windows and the accessibility tree, behind configurable policy gates, confirmations and a redacted audit trail. It does not require any provider's bundled computer-use runtime.",
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
    composerIcon: "./assets/icon.png",
    logo: "./assets/logo.png",
    screenshots: ["./assets/screenshot-1.png"],
  },
});

writeJson(path.join(distRoot, ".codex-mcp.json"), {
  mcpServers: {
    "computer-custom": {
      command: "node",
      args: ["./server/index.mjs"],
      cwd: "./",
      env: {
        COMPUTER_CUSTOM_POLICY: "./config/default-policy.json",
        COMPUTER_CUSTOM_HELPER: "./helper/computer-custom-helper.exe",
        COMPUTER_CUSTOM_FLOWS: "./flows",
      },
    },
  },
});

writeJson(path.join(distRoot, ".claude-plugin", "plugin.json"), {
  name: "computer-custom",
  version: packageMetadata.version,
  description:
    "Self-contained Windows computer control with policy gates. No other runtime required.",
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
  mcpServers: "./.mcp.json",
});

writeJson(path.join(distRoot, ".mcp.json"), {
  mcpServers: {
    "computer-custom": {
      command: "node",
      args: ["${CLAUDE_PLUGIN_ROOT}/server/index.mjs"],
      env: {
        COMPUTER_CUSTOM_POLICY: "${CLAUDE_PLUGIN_ROOT}/config/default-policy.json",
        COMPUTER_CUSTOM_HELPER: "${CLAUDE_PLUGIN_ROOT}/helper/computer-custom-helper.exe",
        // Ships with an example. Point this at a directory of your own to keep
        // your flows when the plugin updates.
        COMPUTER_CUSTOM_FLOWS: "${CLAUDE_PLUGIN_ROOT}/flows",
      },
    },
  },
});

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function writeJson(to, value) {
  fs.writeFileSync(to, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
