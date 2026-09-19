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
  it("documents the self-contained contract, not a provider runtime", () => {
    const skill = fs.readFileSync(
      path.resolve("overlay", "skills", "computer-custom", "SKILL.md"),
      "utf8",
    );

    // The whole point of the rebuild: no dependency on a bundled runtime.
    assert.doesNotMatch(skill, /@oai\/sky/);
    assert.doesNotMatch(skill, /officialSky/);
    assert.doesNotMatch(skill, /globalThis\.sky/);

    // The guidance an agent actually needs to use this correctly.
    assert.match(skill, /ui_tree/);
    assert.match(skill, /truncated/);
    assert.match(skill, /UIPI_BLOCKED/);
    assert.match(skill, /SECURE_DESKTOP/);
    assert.match(skill, /Never write a confirmation phrase yourself/i);
  });

  it("wraps the package-exported sky without a legacy client file", async () => {
    const fixture = createFixture();
    fs.unlinkSync(fixture.officialClientPath);
    const calls = [];
    const officialSky = {
      async list_apps() { return [{ id: "package-app", windows: [] }]; },
      async click(input) { calls.push(input); },
    };
    const globals = {};
    const wrapped = await setupComputerCustomRuntime({
      globals, officialSky, policyPath: fixture.policyPath,
    });
    assert.notEqual(wrapped, officialSky);
    assert.deepEqual(await wrapped.list_apps(), [{ id: "package-app", windows: [] }]);
    await assert.rejects(
      wrapped.click({ window: { app: "cmd.exe", id: 1 }, x: 1, y: 1 }),
      /Computer Custom blocked click/,
    );
    assert.equal(calls.length, 0);
    assert.equal(globals.computerCustomAudit.at(-1).decision, "block");
  });

  it("wraps an existing package sky again if the global wrapper was replaced", async () => {
    const fixture = createFixture();
    const original = { async list_apps() { return [{ id: "first" }]; } };
    const globals = { sky: original };
    const first = await setupComputerCustomRuntime({ globals, policyPath: fixture.policyPath });
    assert.notEqual(first, original);
    assert.equal(await setupComputerCustomRuntime({ globals, policyPath: fixture.policyPath }), first);
    globals.sky = { async list_apps() { return [{ id: "replacement" }]; } };
    const second = await setupComputerCustomRuntime({ globals, policyPath: fixture.policyPath });
    assert.notEqual(first, second);
    assert.deepEqual(await second.list_apps(), [{ id: "replacement" }]);
    assert.equal(globals.computerCustomRuntime.sky, globals.sky);
  });

  it("wraps an already initialized official sky instead of skipping setup", async () => {
    const fixture = createFixture();
    const preexistingSky = { async list_apps() { return []; } };
    const globals = { sky: preexistingSky };

    await setupComputerCustomRuntime({
      globals,
      officialClientPath: fixture.officialClientPath,
      policyPath: fixture.policyPath,
    });

    assert.notEqual(globals.sky, preexistingSky);
    assert.equal(globals.computerCustomRuntime.wrapped, true);
    assert.deepEqual(await globals.sky.list_apps(), [{ id: "safe-app", windows: [] }]);
  });

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
