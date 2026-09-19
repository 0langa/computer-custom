/**
 * Where the server gets its policy and where it writes its audit trail.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type PolicyConfig, loadPolicy } from "../policy.mjs";

export type ServerConfig = {
  policy: PolicyConfig;
  policyPath: string;
  auditPath: string | undefined;
};

export function loadServerConfig(): ServerConfig {
  const policyPath = resolvePolicyPath();
  return {
    policy: loadPolicy(policyPath),
    policyPath,
    auditPath: resolveAuditPath(),
  };
}

/**
 * `COMPUTER_CUSTOM_POLICY` wins, then the packaged default next to this file.
 * Both providers use the same variable, so one config governs both.
 */
function resolvePolicyPath(): string {
  const override = process.env.COMPUTER_CUSTOM_POLICY;
  if (override) {
    if (!fs.existsSync(override)) {
      throw new Error(`COMPUTER_CUSTOM_POLICY points at a file that does not exist: ${override}`);
    }

    return override;
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "..", "config", "default-policy.json"),
    path.resolve(here, "..", "..", "config", "default-policy.json"),
    path.resolve(here, "..", "..", "overlay", "config", "default-policy.json"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Could not find a policy file. Looked in:\n${candidates.join("\n")}\nSet COMPUTER_CUSTOM_POLICY to one.`,
  );
}

function resolveAuditPath(): string | undefined {
  const override = process.env.COMPUTER_CUSTOM_AUDIT;
  if (override) {
    return override;
  }

  const dataDir = process.env.CLAUDE_PLUGIN_DATA ?? process.env.COMPUTER_CUSTOM_DATA;
  return dataDir ? path.join(dataDir, "audit.jsonl") : undefined;
}
