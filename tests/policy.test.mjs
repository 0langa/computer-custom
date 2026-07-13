import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifySkyCall,
  expandEnvironmentRoot,
  redactForAudit,
} from "../build/policy.mjs";
import policy from "../overlay/config/default-policy.json" with { type: "json" };

describe("policy classifier", () => {
  it("blocks protected Windows roots", () => {
    const decision = classifySkyCall(
      "type_text",
      [{ text: "delete C:\\Windows\\System32" }],
      policy,
      {
        home: "C:\\Users\\Tester",
        programFiles: "C:\\Program Files",
        programFilesX86: "C:\\Program Files (x86)",
        systemRoot: "C:\\Windows",
        winDir: "C:\\Windows",
      },
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

  it("allows read-only inspection of protected and security windows", () => {
    const decision = classifySkyCall(
      "get_window_state",
      [{ window: { app: "Microsoft Defender", id: 42 } }],
      policy,
      {},
    );

    assert.equal(decision.action, "allow");
  });

  it("does not treat missing environment roots as the current directory", () => {
    assert.equal(expandEnvironmentRoot("%WINDIR%", {}), "");

    const decision = classifySkyCall(
      "launch_app",
      [{ app: "Microsoft.WindowsNotepad_8wekyb3d8bbwe!App" }],
      policy,
      {},
    );
    assert.equal(decision.action, "allow");
  });

  it("requires confirmation for security app input", () => {
    const decision = classifySkyCall(
      "click",
      [{ window: { app: "Avira.Spotlight.UI.Application.Messaging.exe", id: 7 }, x: 10, y: 10 }],
      policy,
      {},
    );

    assert.equal(decision.action, "confirm");
    assert.equal(decision.phrase, "I UNDERSTAND");
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
