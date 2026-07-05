import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { appendAuditEntry, classifySkyCall, loadPolicy, redactForAudit, } from "./policy.mjs";
export async function setupComputerCustomRuntime({ globals = globalThis, officialClientPath, policyPath, } = {}) {
    const resolvedOfficialClientPath = officialClientPath ?? resolveOfficialComputerUseClientPath();
    const officialModule = await import(pathToFileURL(resolvedOfficialClientPath).href);
    if (typeof officialModule.setupComputerUseRuntime !== "function") {
        throw new Error(`Computer Custom expected setupComputerUseRuntime export at ${resolvedOfficialClientPath}`);
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
    globals.sky = createPolicySkyProxy(globals.sky, { globals, policy });
    return globals.sky;
}
export function resolveOfficialComputerUseClientPath() {
    const explicitClient = process.env.COMPUTER_CUSTOM_OFFICIAL_CLIENT?.trim();
    if (explicitClient) {
        return assertComputerUseClient(explicitClient);
    }
    const explicitRoot = process.env.COMPUTER_USE_PLUGIN_ROOT?.trim();
    if (explicitRoot) {
        return assertComputerUseClient(path.join(explicitRoot, "scripts", "computer-use-client.mjs"));
    }
    const bundledRoot = path.join(os.homedir(), ".codex", "plugins", "cache", "openai-bundled", "computer-use");
    const versions = fs
        .readdirSync(bundledRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort(compareVersionDesc);
    for (const version of versions) {
        const candidate = path.join(bundledRoot, version, "scripts", "computer-use-client.mjs");
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    throw new Error("Computer Custom could not locate bundled Computer Use runtime");
}
export function resolveDefaultPolicyPath() {
    const fromEnvironment = process.env.COMPUTER_CUSTOM_POLICY?.trim();
    if (fromEnvironment) {
        return fromEnvironment;
    }
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "config", "default-policy.json");
}
function createPolicySkyProxy(sky, context) {
    return new Proxy(sky, {
        get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver);
            if (typeof property !== "string" || typeof value !== "function") {
                return value;
            }
            return async (...args) => {
                const decision = classifySkyCall(property, args, context.policy);
                await enforceDecision(context.globals, property, args, decision);
                const auditEntry = {
                    at: new Date().toISOString(),
                    args: redactForAudit(args, context.policy),
                    decision: decision.action,
                    method: property,
                    reason: decision.reason,
                };
                try {
                    const result = await Reflect.apply(value, target, args);
                    auditEntry.ok = true;
                    appendAuditEntry(context.globals, auditEntry, context.policy.audit.maxEntries);
                    return result;
                }
                catch (error) {
                    auditEntry.ok = false;
                    auditEntry.error = error instanceof Error ? error.message : String(error);
                    appendAuditEntry(context.globals, auditEntry, context.policy.audit.maxEntries);
                    throw error;
                }
            };
        },
    });
}
async function enforceDecision(globals, method, args, decision) {
    if (decision.action === "allow") {
        return;
    }
    if (decision.action === "block") {
        throw new Error(`Computer Custom blocked ${method}: ${decision.reason}; matches=${decision.matches.join(", ")}`);
    }
    const confirmed = await requestExactPhraseConfirmation(globals, {
        args,
        decision,
        method,
    });
    if (!confirmed) {
        throw new Error(`Computer Custom denied ${method}: confirmation phrase was not provided`);
    }
}
async function requestExactPhraseConfirmation(globals, input) {
    const createElicitation = globals.nodeRepl?.createElicitation;
    if (typeof createElicitation !== "function") {
        throw new Error("Computer Custom confirmation UI is unavailable outside trusted node_repl");
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
function extractStrings(value) {
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
function assertComputerUseClient(candidate) {
    if (!fs.existsSync(candidate)) {
        throw new Error(`Computer Use client not found: ${candidate}`);
    }
    return candidate;
}
function compareVersionDesc(left, right) {
    return right.localeCompare(left, undefined, {
        numeric: true,
        sensitivity: "base",
    });
}
