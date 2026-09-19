import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const READ_ONLY_METHODS = new Set([
    // legacy sky method names
    "documentation",
    "get_window",
    "get_window_state",
    "list_apps",
    "list_windows",
    "screenshot",
    // self-contained MCP tool names (see docs/PROTOCOL.md)
    "ping",
    "ui_tree",
    "cursor_position",
    "clipboard_get",
    "fs_read",
    "list_flows",
]);
/**
 * Methods whose arguments are checked against `protectedRoots`.
 *
 * Only methods that can carry a filesystem path worth guarding belong here.
 * Checking every method would block ordinary clicks whose surrounding payload
 * happens to mention a protected directory.
 */
const PROTECTED_ROOT_INPUT_METHODS = new Set([
    "set_value",
    "type_text",
    "fs_write",
    "fs_delete",
    "run_shell",
]);
export function loadPolicy(policyPath) {
    const raw = fs.readFileSync(policyPath, "utf8");
    return JSON.parse(raw);
}
export function classifySkyCall(method, args, policy, environment = readPolicyEnvironment()) {
    if (READ_ONLY_METHODS.has(method)) {
        return {
            action: "allow",
            reason: "Read-only method",
        };
    }
    const expandedRoots = policy.protectedRoots
        .map((root) => expandEnvironmentRoot(root, environment))
        .filter((value) => value.length > 0);
    const normalizedPayload = normalizeForMatching({ method, args });
    const protectedRootPayload = PROTECTED_ROOT_INPUT_METHODS.has(method)
        ? normalizedPayload
        : "";
    const protectedRootMatches = expandedRoots.filter((root) => protectedRootPayload.includes(root.toLowerCase()));
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
    if (policy.confirm.alwaysConfirmMethods?.includes(method)) {
        return {
            action: "confirm",
            reason: "Method always requires confirmation",
            risk: "irreversible",
            phrase: policy.confirm.phrase,
            matches: [method],
        };
    }
    const confirmMatches = [
        ...matchPatterns(normalizedPayload, policy.confirm.appPatterns),
        ...matchPatterns(normalizedPayload, policy.confirm.textPatterns),
    ];
    if (policy.confirm.riskyMethods.includes(method) &&
        confirmMatches.length > 0) {
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
/**
 * Classify an MCP tool call from the self-contained server.
 *
 * Same gates as {@link classifySkyCall}; the only difference is the call shape.
 * Sky methods take positional arguments, MCP tools take one named-argument
 * object. Both are normalised to the same JSON payload before matching, so a
 * pattern written for one form keeps working for the other and a single policy
 * file governs both providers.
 */
export function classifyToolCall(tool, args, policy, environment) {
    return classifySkyCall(tool, [args], policy, environment);
}
export function redactForAudit(value, policy) {
    return redactUnknown(value, policy, new WeakSet());
}
export function appendAuditEntry(globals, entry, maxEntries) {
    const existing = Array.isArray(globals.computerCustomAudit)
        ? globals.computerCustomAudit
        : [];
    existing.push(entry);
    while (existing.length > maxEntries) {
        existing.shift();
    }
    globals.computerCustomAudit = existing;
}
export function expandEnvironmentRoot(value, environment = readPolicyEnvironment()) {
    const env = {
        "%HOME%": environment.home ?? "",
        "%PROGRAMFILES%": environment.programFiles ?? "",
        "%PROGRAMFILES(X86)%": environment.programFilesX86 ?? "",
        "%SYSTEMROOT%": environment.systemRoot ?? "",
        "%WINDIR%": environment.winDir ?? "",
    };
    let expanded = value;
    for (const [token, replacement] of Object.entries(env)) {
        if (expanded.includes(token) && replacement.length === 0) {
            return "";
        }
        expanded = expanded.replaceAll(token, replacement);
    }
    if (/%[^%]+%/.test(expanded) || expanded.trim().length === 0) {
        return "";
    }
    return normalizePathText(expanded);
}
function readPolicyEnvironment() {
    const driveRoot = path.parse(os.homedir()).root || "C:\\";
    const defaultWindowsRoot = path.join(driveRoot, "Windows");
    return {
        home: os.homedir(),
        programFiles: readEnvironmentValue("ProgramFiles") ?? path.join(driveRoot, "Program Files"),
        programFilesX86: readEnvironmentValue("ProgramFiles(x86)") ?? path.join(driveRoot, "Program Files (x86)"),
        systemRoot: readEnvironmentValue("SystemRoot") ?? defaultWindowsRoot,
        winDir: readEnvironmentValue("WINDIR") ?? defaultWindowsRoot,
    };
}
function readEnvironmentValue(name) {
    const processEnv = globalThis.process?.env;
    const processValue = processEnv?.[name];
    if (typeof processValue === "string") {
        return processValue;
    }
    const nodeReplEnv = globalThis.nodeRepl?.env;
    const nodeReplValue = nodeReplEnv?.[name];
    return typeof nodeReplValue === "string" ? nodeReplValue : undefined;
}
function normalizePathText(value) {
    return path.normalize(value).replaceAll("/", "\\").toLowerCase();
}
function normalizeForMatching(value) {
    return JSON.stringify(value, (_key, innerValue) => {
        if (typeof innerValue === "string") {
            return innerValue.replaceAll("/", "\\");
        }
        return innerValue;
    })
        .replaceAll("\\\\", "\\")
        .toLowerCase();
}
function matchPatterns(payload, patterns) {
    const matches = [];
    for (const pattern of patterns) {
        const regex = new RegExp(pattern, "i");
        if (regex.test(payload)) {
            matches.push(pattern);
        }
    }
    return matches;
}
function redactUnknown(value, policy, seen) {
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
    const output = {};
    for (const [key, innerValue] of Object.entries(value)) {
        if (keyMatchesSecretPolicy(key, policy)) {
            output[key] = "[REDACTED]";
            continue;
        }
        output[key] = redactUnknown(innerValue, policy, seen);
    }
    return output;
}
function keyMatchesSecretPolicy(key, policy) {
    return policy.audit.redactKeyPatterns.some((pattern) => new RegExp(pattern, "i").test(key));
}
function redactString(value, policy) {
    let redacted = value;
    for (const pattern of policy.audit.redactValuePatterns) {
        redacted = redacted.replace(new RegExp(pattern, "gi"), "[REDACTED]");
    }
    return redacted;
}
