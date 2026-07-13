import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  authorizePendingComputerCustomAction,
  setupComputerCustomRuntime,
} from "../build/runtime.mjs";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe("Computer Custom runtime", () => {
  it("wraps safe calls once and records successful audit entries", async () => {
    const fixture = createFixture();
    const globals = {};

    const first = await setupComputerCustomRuntime({
      globals,
      officialClientPath: fixture.officialClientPath,
      policyPath: fixture.policyPath,
    });
    const second = await setupComputerCustomRuntime({
      globals,
      officialClientPath: fixture.officialClientPath,
      policyPath: fixture.policyPath,
    });

    assert.equal(first, second);
    assert.deepEqual(await globals.sky.list_apps(), [{ id: "safe-app", windows: [] }]);
    assert.equal(globals.computerCustomAudit.length, 1);
    assert.equal(globals.computerCustomAudit[0].decision, "allow");
    assert.equal(globals.computerCustomAudit[0].ok, true);
  });

  it("audits hard-blocked calls without invoking the official runtime", async () => {
    const fixture = createFixture();
    const globals = {};
    await setupComputerCustomRuntime({
      globals,
      officialClientPath: fixture.officialClientPath,
      policyPath: fixture.policyPath,
    });

    await assert.rejects(
      globals.sky.click({ window: { app: "cmd.exe", id: 1 }, x: 1, y: 1 }),
      /Computer Custom blocked click/,
    );
    assert.equal(globals.officialCalls.length, 0);
    assert.equal(globals.computerCustomAudit.at(-1).decision, "block");
    assert.equal(globals.computerCustomAudit.at(-1).ok, false);
  });

  it("supports one-shot chat confirmation when elicitation is unavailable", async () => {
    const fixture = createFixture();
    const globals = {};
    await setupComputerCustomRuntime({
      globals,
      officialClientPath: fixture.officialClientPath,
      policyPath: fixture.policyPath,
    });
    const action = {
      window: { app: "Avira.Spotlight.UI.Application.Messaging.exe", id: 7 },
      x: 10,
      y: 10,
    };

    await assert.rejects(globals.sky.click(action), /needs chat confirmation/);
    assert.equal(globals.computerCustomPendingConfirmation.method, "click");
    assert.throws(
      () => authorizePendingComputerCustomAction(globals, "WRONG"),
      /phrase did not match/,
    );

    const authorization = globals.computerCustomAuthorizePending("I UNDERSTAND");
    assert.equal(authorization.method, "click");
    assert.deepEqual(await globals.sky.click(action), { clicked: true });
    assert.equal(globals.computerCustomAuthorizedConfirmation, undefined);
    assert.equal(globals.officialCalls.length, 1);
    assert.deepEqual(
      globals.computerCustomAudit.map((entry) => [entry.decision, entry.ok]),
      [
        ["confirm", false],
        ["confirm", true],
      ],
    );
  });

  it("audits failures returned by the official runtime", async () => {
    const fixture = createFixture();
    const globals = {};
    await setupComputerCustomRuntime({
      globals,
      officialClientPath: fixture.officialClientPath,
      policyPath: fixture.policyPath,
    });

    await assert.rejects(globals.sky.fail(), /official failure/);
    assert.equal(globals.computerCustomAudit.at(-1).ok, false);
    assert.equal(globals.computerCustomAudit.at(-1).error, "official failure");
  });
});

function createFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "computer-custom-test-"));
  temporaryDirectories.push(directory);
  const officialClientPath = path.join(directory, "official-client.mjs");
  const policyPath = path.join(directory, "policy.json");

  fs.writeFileSync(
    officialClientPath,
    `export async function setupComputerUseRuntime({ globals }) {
      globals.officialCalls = [];
      globals.sky = {
        async click(input) {
          globals.officialCalls.push(["click", input]);
          return { clicked: true };
        },
        async fail() {
          throw new Error("official failure");
        },
        async list_apps() {
          return [{ id: "safe-app", windows: [] }];
        },
      };
    }\n`,
    "utf8",
  );
  fs.writeFileSync(
    policyPath,
    JSON.stringify({
      protectedRoots: ["%WINDIR%"],
      hardBlock: {
        appPatterns: ["\\bcmd\\.exe\\b"],
        textPatterns: [],
      },
      confirm: {
        riskyMethods: ["click"],
        appPatterns: ["\\bAvira\\b"],
        textPatterns: [],
        phrase: "I UNDERSTAND",
      },
      audit: {
        maxEntries: 20,
        redactKeyPatterns: ["TOKEN", "KEY", "SECRET", "PASSWORD", "CREDENTIAL"],
        redactValuePatterns: [],
      },
    }),
    "utf8",
  );

  return { officialClientPath, policyPath };
}
