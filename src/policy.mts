import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type PolicyDecision =
  | {
      action: "allow";
      reason: string;
    }
  | {
      action: "confirm";
      reason: string;
      risk: string;
      phrase: string;
      matches: string[];
    }
  | {
      action: "block";
      reason: string;
      matches: string[];
    };

export type PolicyConfig = {
  protectedRoots: string[];
  hardBlock: {
    appPatterns: string[];
    textPatterns: string[];
  };
  confirm: {
    riskyMethods: string[];
    appPatterns: string[];
    textPatterns: string[];
    phrase: string;
  };
  audit: {
    maxEntries: number;
    redactKeyPatterns: string[];
    redactValuePatterns: string[];
  };
};

export type AuditEntry = {
  at: string;
  method: string;
  decision: PolicyDecision["action"];
  reason: string;
  args: unknown;
  ok?: boolean;
  error?: string;
};

export function loadPolicy(policyPath: string): PolicyConfig {
  const raw = fs.readFileSync(policyPath, "utf8");
  return JSON.parse(raw) as PolicyConfig;
}

export function classifySkyCall(
  method: string,
  args: unknown[],
  policy: PolicyConfig,
): PolicyDecision {
  const expandedRoots = policy.protectedRoots
    .map(expandEnvironmentRoot)
    .filter((value) => value.length > 0);
  const normalizedPayload = normalizeForMatching({ method, args });

  const protectedRootMatches = expandedRoots.filter((root) =>
    normalizedPayload.includes(root.toLowerCase()),
  );
  if (protectedRootMatches.length > 0) {
    return {
      action: "block",
      reason: "Protected system path matched policy",
      matches: protectedRootMatches,
    };
  }

  const hardBlockMatches = [
    ...matchPatterns(normalizedPayload, policy.hardBlock.appPatterns),
    ...matchPatterns(normalizedPayload, policy.hardBlock.textPatterns),
  ];
  if (hardBlockMatches.length > 0) {
    return {
      action: "block",
      reason: "Hard-block policy matched request",
      matches: hardBlockMatches,
    };
  }

  const confirmMatches = [
    ...matchPatterns(normalizedPayload, policy.confirm.appPatterns),
    ...matchPatterns(normalizedPayload, policy.confirm.textPatterns),
  ];
  if (
    policy.confirm.riskyMethods.includes(method) &&
    confirmMatches.length > 0
  ) {
    return {
      action: "confirm",
      reason: "Risky action matched confirmation policy",
      risk: "sensitive-or-destructive",
      phrase: policy.confirm.phrase,
      matches: confirmMatches,
    };
  }

  return {
    action: "allow",
    reason: "No policy gate matched",
  };
}

export function redactForAudit(value: unknown, policy: PolicyConfig): unknown {
  return redactUnknown(value, policy, new WeakSet<object>());
}

export function appendAuditEntry(
  globals: Record<string, unknown>,
  entry: AuditEntry,
  maxEntries: number,
): void {
  const existing = Array.isArray(globals.computerCustomAudit)
    ? globals.computerCustomAudit
    : [];
  existing.push(entry);
  while (existing.length > maxEntries) {
    existing.shift();
  }
  globals.computerCustomAudit = existing;
}

function expandEnvironmentRoot(value: string): string {
  const env = {
    "%HOME%": os.homedir(),
    "%PROGRAMFILES%": process.env.ProgramFiles ?? "",
    "%PROGRAMFILES(X86)%": process.env["ProgramFiles(x86)"] ?? "",
    "%SYSTEMROOT%": process.env.SystemRoot ?? "",
    "%WINDIR%": process.env.WINDIR ?? "",
  };
  let expanded = value;
  for (const [token, replacement] of Object.entries(env)) {
    expanded = expanded.replaceAll(token, replacement);
  }
  return normalizePathText(expanded);
}

function normalizePathText(value: string): string {
  return path.normalize(value).replaceAll("/", "\\").toLowerCase();
}

function normalizeForMatching(value: unknown): string {
  return JSON.stringify(value, (_key, innerValue) => {
    if (typeof innerValue === "string") {
      return innerValue.replaceAll("/", "\\");
    }
    return innerValue;
  })
    .replaceAll("\\\\", "\\")
    .toLowerCase();
}

function matchPatterns(payload: string, patterns: string[]): string[] {
  const matches: string[] = [];
  for (const pattern of patterns) {
    const regex = new RegExp(pattern, "i");
    if (regex.test(payload)) {
      matches.push(pattern);
    }
  }
  return matches;
}

function redactUnknown(
  value: unknown,
  policy: PolicyConfig,
  seen: WeakSet<object>,
): unknown {
  if (typeof value === "string") {
    return redactString(value, policy);
  }
  if (value == null || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactUnknown(item, policy, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [key, innerValue] of Object.entries(value)) {
    if (keyMatchesSecretPolicy(key, policy)) {
      output[key] = "[REDACTED]";
      continue;
    }
    output[key] = redactUnknown(innerValue, policy, seen);
  }
  return output;
}

function keyMatchesSecretPolicy(key: string, policy: PolicyConfig): boolean {
  return policy.audit.redactKeyPatterns.some((pattern) =>
    new RegExp(pattern, "i").test(key),
  );
}

function redactString(value: string, policy: PolicyConfig): string {
  let redacted = value;
  for (const pattern of policy.audit.redactValuePatterns) {
    redacted = redacted.replace(new RegExp(pattern, "gi"), "[REDACTED]");
  }
  return redacted;
}
