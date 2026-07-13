import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  appendAuditEntry,
  classifySkyCall,
  loadPolicy,
  redactForAudit,
  type AuditEntry,
  type PolicyConfig,
  type PolicyDecision,
} from "./policy.mjs";

export type SetupComputerCustomRuntimeOptions = {
  globals?: Record<string, any>;
  officialClientPath?: string;
  policyPath?: string;
};

type PendingConfirmation = {
  expiresAt: number;
  fingerprint: string;
  method: string;
  phrase: string;
  reason: string;
};

const PENDING_CONFIRMATION_TTL_MS = 5 * 60 * 1000;
const AUTHORIZED_CONFIRMATION_TTL_MS = 60 * 1000;

export async function setupComputerCustomRuntime({
  globals = globalThis as Record<string, any>,
  officialClientPath,
  policyPath,
}: SetupComputerCustomRuntimeOptions = {}): Promise<unknown> {
  const existingRuntime = globals.computerCustomRuntime;
  if (
    existingRuntime?.wrapped === true &&
    existingRuntime.sky != null &&
    globals.sky === existingRuntime.sky
  ) {
    return globals.sky;
  }

  const resolvedOfficialClientPath =
    officialClientPath ?? resolveOfficialComputerUseClientPath();
  const officialModule = await import(pathToFileURL(resolvedOfficialClientPath).href);

  if (typeof officialModule.setupComputerUseRuntime !== "function") {
    throw new Error(
      `Computer Custom expected setupComputerUseRuntime export at ${resolvedOfficialClientPath}`,
    );
  }

  await officialModule.setupComputerUseRuntime({ globals });

  if (globals.sky == null || typeof globals.sky !== "object") {
    throw new Error("Computer Custom could not find initialized sky runtime");
  }

  const policy = loadPolicy(policyPath ?? resolveDefaultPolicyPath());
  globals.computerCustomPolicy = policy;
  globals.computerCustomAudit = Array.isArray(globals.computerCustomAudit)
    ? globals.computerCustomAudit
    : [];
  globals.computerCustomAuthorizePending = (phrase: string) =>
    authorizePendingComputerCustomAction(globals, phrase);
  const wrappedSky = createPolicySkyProxy(globals.sky, { globals, policy });
  globals.sky = wrappedSky;
  globals.computerCustomRuntime = {
    officialClientPath: resolvedOfficialClientPath,
    policyPath: policyPath ?? resolveDefaultPolicyPath(),
    sky: wrappedSky,
    wrapped: true,
  };
  return wrappedSky;
}

export function authorizePendingComputerCustomAction(
  globals: Record<string, any>,
  phrase: string,
): { expiresAt: number; method: string; reason: string } {
  const pending = globals.computerCustomPendingConfirmation as
    | PendingConfirmation
    | undefined;
  if (pending == null) {
    throw new Error("Computer Custom has no pending action to authorize");
  }
  if (pending.expiresAt <= Date.now()) {
    delete globals.computerCustomPendingConfirmation;
    throw new Error("Computer Custom pending confirmation expired");
  }
  if (phrase !== pending.phrase) {
    throw new Error("Computer Custom confirmation phrase did not match");
  }

  const expiresAt = Date.now() + AUTHORIZED_CONFIRMATION_TTL_MS;
  globals.computerCustomAuthorizedConfirmation = {
    expiresAt,
    fingerprint: pending.fingerprint,
  };
  delete globals.computerCustomPendingConfirmation;
  return {
    expiresAt,
    method: pending.method,
    reason: pending.reason,
  };
}

export function resolveOfficialComputerUseClientPath(): string {
  const explicitClient = readEnvironmentValue(
    "COMPUTER_CUSTOM_OFFICIAL_CLIENT",
  )?.trim();
  if (explicitClient) {
    return assertComputerUseClient(explicitClient);
  }

  const explicitRoot = readEnvironmentValue("COMPUTER_USE_PLUGIN_ROOT")?.trim();
  if (explicitRoot) {
    return assertComputerUseClient(
      path.join(explicitRoot, "scripts", "computer-use-client.mjs"),
    );
  }

  const bundledRoot = path.join(
    os.homedir(),
    ".codex",
    "plugins",
    "cache",
    "openai-bundled",
    "computer-use",
  );
  const versions = fs
    .readdirSync(bundledRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareVersionDesc);

  for (const version of versions) {
    const candidate = path.join(
      bundledRoot,
      version,
      "scripts",
      "computer-use-client.mjs",
    );
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("Computer Custom could not locate bundled Computer Use runtime");
}

export function resolveDefaultPolicyPath(): string {
  const fromEnvironment = readEnvironmentValue("COMPUTER_CUSTOM_POLICY")?.trim();
  if (fromEnvironment) {
    return fromEnvironment;
  }
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "config",
    "default-policy.json",
  );
}

function readEnvironmentValue(name: string): string | undefined {
  const processEnv = (globalThis as any).process?.env;
  const processValue = processEnv?.[name];
  if (typeof processValue === "string") {
    return processValue;
  }

  const nodeReplEnv = (globalThis as any).nodeRepl?.env;
  const nodeReplValue = nodeReplEnv?.[name];
  return typeof nodeReplValue === "string" ? nodeReplValue : undefined;
}

function createPolicySkyProxy(
  sky: Record<string, any>,
  context: { globals: Record<string, any>; policy: PolicyConfig },
): unknown {
  return new Proxy(sky, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof property !== "string" || typeof value !== "function") {
        return value;
      }

      return async (...args: unknown[]) => {
        const decision = classifySkyCall(property, args, context.policy);
        const auditEntry: AuditEntry = {
          at: new Date().toISOString(),
          args: redactForAudit(args, context.policy),
          decision: decision.action,
          method: property,
          reason: decision.reason,
        };

        try {
          await enforceDecision(context.globals, property, args, decision);
          const result = await Reflect.apply(value, target, args);
          auditEntry.ok = true;
          return result;
        } catch (error) {
          auditEntry.ok = false;
          auditEntry.error = error instanceof Error ? error.message : String(error);
          throw error;
        } finally {
          appendAuditEntry(
            context.globals,
            auditEntry,
            context.policy.audit.maxEntries,
          );
        }
      };
    },
  });
}

async function enforceDecision(
  globals: Record<string, any>,
  method: string,
  args: unknown[],
  decision: PolicyDecision,
): Promise<void> {
  if (decision.action === "allow") {
    return;
  }
  if (decision.action === "block") {
    throw new Error(
      `Computer Custom blocked ${method}: ${decision.reason}; matches=${decision.matches.join(", ")}`,
    );
  }

  const confirmed = await requestExactPhraseConfirmation(globals, {
    args,
    decision,
    method,
  });
  if (!confirmed) {
    throw new Error(
      `Computer Custom denied ${method}: confirmation phrase was not provided`,
    );
  }
}

async function requestExactPhraseConfirmation(
  globals: Record<string, any>,
  input: {
    args: unknown[];
    decision: Extract<PolicyDecision, { action: "confirm" }>;
    method: string;
  },
): Promise<boolean> {
  const fingerprint = confirmationFingerprint(input.method, input.args);
  const authorized = globals.computerCustomAuthorizedConfirmation;
  if (
    authorized?.fingerprint === fingerprint &&
    typeof authorized.expiresAt === "number" &&
    authorized.expiresAt > Date.now()
  ) {
    delete globals.computerCustomAuthorizedConfirmation;
    return true;
  }

  const createElicitation = globals.nodeRepl?.createElicitation;
  if (typeof createElicitation !== "function") {
    globals.computerCustomPendingConfirmation = {
      expiresAt: Date.now() + PENDING_CONFIRMATION_TTL_MS,
      fingerprint,
      method: input.method,
      phrase: input.decision.phrase,
      reason: input.decision.reason,
    } satisfies PendingConfirmation;
    throw new Error(
      "Computer Custom needs chat confirmation. Ask the user for the exact phrase, then call computerCustomAuthorizePending(phrase) and retry the unchanged action.",
    );
  }

  const response = await createElicitation({
    title: "Computer Custom confirmation",
    message: [
      `Method: ${input.method}`,
      `Risk: ${input.decision.risk}`,
      `Reason: ${input.decision.reason}`,
      `Type this phrase exactly: ${input.decision.phrase}`,
    ].join("\n"),
    fields: [
      {
        name: "confirmation",
        label: "Confirmation phrase",
        type: "text",
      },
    ],
  });

  return extractStrings(response).some((value) => value === input.decision.phrase);
}

function confirmationFingerprint(method: string, args: unknown[]): string {
  const serialized = JSON.stringify({ method, args }, createCircularSafeReplacer());
  return createHash("sha256").update(serialized).digest("hex");
}

function createCircularSafeReplacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet<object>();
  return (_key, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    if (typeof value === "function") {
      return `[Function:${value.name || "anonymous"}]`;
    }
    if (value != null && typeof value === "object") {
      if (seen.has(value)) {
        return "[Circular]";
      }
      seen.add(value);
    }
    return value;
  };
}

function extractStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (value == null || typeof value !== "object") {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractStrings(item));
  }
  return Object.values(value).flatMap((item) => extractStrings(item));
}

function assertComputerUseClient(candidate: string): string {
  if (!fs.existsSync(candidate)) {
    throw new Error(`Computer Use client not found: ${candidate}`);
  }
  return candidate;
}

function compareVersionDesc(left: string, right: string): number {
  return right.localeCompare(left, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}
