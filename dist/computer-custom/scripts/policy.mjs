import fs from "node:fs";
import os from "node:os";
import path from "node:path";
export function loadPolicy(policyPath) {
    const raw = fs.readFileSync(policyPath, "utf8");
    return JSON.parse(raw);
}
export function classifySkyCall(method, args, policy) {
    const expandedRoots = policy.protectedRoots
        .map(expandEnvironmentRoot)
        .filter((value) => value.length > 0);
    const normalizedPayload = normalizeForMatching({ method, args });
    const protectedRootMatches = expandedRoots.filter((root) => normalizedPayload.includes(root.toLowerCase()));
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
function expandEnvironmentRoot(value) {
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
