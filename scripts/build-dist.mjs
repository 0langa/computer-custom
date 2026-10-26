import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

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
  entryPoints: ["index", "coordinator-host","helper-check"].map(name => path.join(repoRoot, "build", "server", `${name}.mjs`)),
  outdir: path.join(distRoot, "server"),
  outExtension: { ".js": ".mjs" },
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
copyFile(path.join(repoRoot,"overlay","config","example-restricted-policy.json"),path.join(distRoot,"config","example-restricted-policy.json"));
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
for (const script of ["uac-secure-desktop.ps1", "write-provenance.mjs","activate-helper-install.ps1"]) {
  copyFile(path.join(repoRoot, "scripts", script), path.join(distRoot, "scripts", script));
}
// Elevation is built and signed locally. Ship its build inputs as well as the
// installer, so installing from a plugin cache needs no source checkout.
fs.cpSync(path.join(repoRoot, "helper", "ComputerCustom.Helper"),
  path.join(distRoot, "helper-source", "ComputerCustom.Helper"), {
    recursive: true,
    filter: (source) => !["bin", "obj"].includes(path.basename(source)),
  });

// Which helper source this plugin's binary was built from. The installer writes
// the same file beside the elevated copy, and the server compares the two to
// tell whether the elevated helper is really behind.
fs.mkdirSync(path.join(distRoot, "helper"), { recursive: true });
// Never restamp preserved binaries here. publish-helper.mjs writes their
// provenance only after a successful native build.
copyFile(
  path.join(repoRoot, "overlay", "claude", "hooks", "claude-hooks.json"),
  path.join(distRoot, "hooks", "claude-hooks.json"),
);
for (const flow of ["README.md", "window-report.mjs"]) {
  copyFile(path.join(repoRoot, "flows", flow), path.join(distRoot, "flows", flow));
}
for (const asset of ["icon.png", "logo.png", "logo.svg", "screenshot-1.png"]) {
  copyFile(
    path.join(repoRoot, "overlay", "assets", asset),
    path.join(distRoot, "assets", asset),
  );
}

writeJson(path.join(distRoot, ".codex-plugin", "plugin.json"), {
  name: "computer-custom",
  version: packageMetadata.version,
  description:
    "Explicit Windows automation with prepared batches, shared Snooze and a signed UIAccess helper.",
  author: {
    name: "0langa",
    email: "plugins@0langa.dev",
    url: "https://github.com/0langa",
  },
  homepage: "https://github.com/0langa/computer-custom",
  repository: "https://github.com/0langa/computer-custom",
  license: "MIT",
  keywords: ["computer-use", "windows", "automation", "batches", "codex"],
  skills: "./skills/",
  mcpServers: "./.codex-mcp.json",
  interface: {
    displayName: "Computer Custom",
    shortDescription: "Prepared Windows batches with countdown and Snooze.",
    longDescription:
      "Select Computer Custom for prepared desktop batches, shared countdown/Snooze, UIAccess or saved local flows. Prefer bundled Computer for ordinary desktop work. Custom runs its own MCP server and native Windows helper; host authorization stays authoritative.",
    developerName: "0langa",
    category: "Developer Tools",
    capabilities: ["Interactive", "Read", "Write"],
    websiteURL: "https://github.com/0langa/computer-custom",
    privacyPolicyURL: "https://github.com/0langa/computer-custom#privacy",
    termsOfServiceURL: "https://github.com/0langa/computer-custom#terms",
    defaultPrompt: [
      "Use Computer Custom to prepare a desktop batch",
      "Run my saved Computer Custom flow",
      "Check Computer Custom UIAccess status",
    ],
    brandColor: "#E0457B",
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
    "Explicit Windows automation with prepared batches, shared Snooze and a signed UIAccess helper.",
  author: {
    name: "0langa",
    email: "plugins@0langa.dev",
    url: "https://github.com/0langa",
  },
  homepage: "https://github.com/0langa/computer-custom",
  repository: "https://github.com/0langa/computer-custom",
  license: "MIT",
  keywords: ["computer-use", "windows", "automation", "batches", "claude-code"],
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
