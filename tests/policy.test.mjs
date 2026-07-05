import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifySkyCall,
  redactForAudit,
} from "../build/policy.mjs";
import policy from "../overlay/config/default-policy.json" with { type: "json" };

describe("policy classifier", () => {
  it("blocks protected Windows roots", () => {
    const decision = classifySkyCall(
      "type_text",
      [{ text: "delete C:\\Windows\\System32" }],
      policy,
    );

    assert.equal(decision.action, "block");
  });

  it("requires confirmation for destructive text entry", () => {
    const decision = classifySkyCall(
      "type_text",
      [{ text: "delete old files" }],
      policy,
    );

    assert.equal(decision.action, "confirm");
    assert.equal(decision.phrase, "I UNDERSTAND");
  });

  it("allows read-only app listing", () => {
    const decision = classifySkyCall("list_apps", [], policy);

    assert.equal(decision.action, "allow");
  });
});

describe("audit redaction", () => {
  it("redacts sensitive object keys", () => {
    const redacted = redactForAudit(
      [{ apiKey: "sk-test-secret", text: "normal text" }],
      policy,
    );

    assert.deepEqual(redacted, [{ apiKey: "[REDACTED]", text: "normal text" }]);
  });

  it("redacts token-like values inside strings", () => {
    const redacted = redactForAudit(
      [{ text: "value ghp_123456789012345678901234567890123456" }],
      policy,
    );

    assert.deepEqual(redacted, [{ text: "value [REDACTED]" }]);
  });
});
