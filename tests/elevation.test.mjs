import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { HelperProcess } from "../build/server/helper-process.mjs";

const HELPER = path.resolve(
  "helper/ComputerCustom.Helper/bin/Debug/net10.0-windows/computer-custom-helper.exe",
);

const started = [];
const originalElevated = process.env.COMPUTER_CUSTOM_ELEVATED;
const originalProgramFiles = process.env.ProgramFiles;

afterEach(() => {
  for (const helper of started.splice(0)) {
    helper.stop();
  }

  restore("COMPUTER_CUSTOM_ELEVATED", originalElevated);
  restore("ProgramFiles", originalProgramFiles);
});

function restore(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

/**
 * Points the installed-helper lookup at an empty directory, so the "not
 * installed" path is exercised whether or not this machine has the real
 * elevated helper installed.
 */
function pretendNotInstalled() {
  process.env.ProgramFiles = fs.mkdtempSync(path.join(os.tmpdir(), "cc-no-install-"));
}

function track(helper) {
  started.push(helper);
  return helper;
}

describe("helper start mode", { skip: !fs.existsSync(HELPER) && "helper not built" }, () => {
  it("asks for elevation by default", async () => {
    // Opt-out, not opt-in: this plugin is invoked because more reach is
    // wanted. With no signed helper installed it still falls back cleanly.
    pretendNotInstalled();
    delete process.env.COMPUTER_CUSTOM_ELEVATED;
    const helper = track(new HelperProcess({ executablePath: HELPER }));

    await helper.call("ping");

    assert.equal(helper.startInfo.requested, "elevated");
  });

  it("can be forced down to normal privilege", async () => {
    process.env.COMPUTER_CUSTOM_ELEVATED = "0";
    const helper = track(new HelperProcess({ executablePath: HELPER }));

    await helper.call("ping");

    assert.deepEqual(helper.startInfo, { requested: "normal", actual: "normal" });
  });

  it("never claims uiAccess for the unsigned development helper", async () => {
    // uiAccess is granted only to a signed binary in a protected folder, so the
    // development build must always report false, however it was started.
    process.env.COMPUTER_CUSTOM_ELEVATED = "0";
    const helper = track(new HelperProcess({ executablePath: HELPER }));

    const ping = (await helper.call("ping")).result;

    assert.equal(ping.uiAccess, false);
    assert.ok(["medium", "high"].includes(ping.power), `unexpected power: ${ping.power}`);
  });

  it("does not mistake inherited integrity for an elevated start", async () => {
    // A helper spawned from an already-elevated parent inherits high integrity.
    // That is NOT the same as having been started through the signed uiAccess
    // path, and reporting it as such would tell the agent it can reach windows
    // it cannot. startInfo must describe the launch route, ping the reality.
    process.env.COMPUTER_CUSTOM_ELEVATED = "0";
    const helper = track(new HelperProcess({ executablePath: HELPER }));

    const ping = (await helper.call("ping")).result;

    assert.equal(helper.startInfo.actual, "normal");
    if (ping.power === "high") {
      assert.equal(ping.uiAccess, false);
    }
  });

  it("falls back and explains itself when elevation is unavailable", async () => {
    // The point of this test: asking for elevation you cannot have must not
    // fail the session, and must not silently pretend to have succeeded.
    pretendNotInstalled();
    process.env.COMPUTER_CUSTOM_ELEVATED = "1";
    const helper = track(new HelperProcess({ executablePath: HELPER }));

    await helper.call("ping");

    assert.equal(helper.startInfo.requested, "elevated");
    assert.equal(helper.startInfo.actual, "normal");
    assert.match(helper.startInfo.notice, /not installed/);
    assert.match(helper.startInfo.notice, /install-elevated-helper\.ps1/);
  });

  it("leaves no session token on disk after a fallback", async () => {
    pretendNotInstalled();
    process.env.COMPUTER_CUSTOM_ELEVATED = "1";
    const helper = track(new HelperProcess({ executablePath: HELPER }));
    await helper.call("ping");

    const sessionFile = path.join(
      process.env.LOCALAPPDATA ?? "",
      "computer-custom",
      "session.json",
    );

    assert.equal(fs.existsSync(sessionFile), false);
  });

  /**
   * Stands up a fake Program Files install of the helper, optionally with a
   * build id beside it, and backdates the binary so a timestamp comparison
   * would call it stale.
   */
  function fakeInstall(buildId) {
    const fakeProgramFiles = fs.mkdtempSync(path.join(os.tmpdir(), "cc-stale-"));
    const installDir = path.join(fakeProgramFiles, "Computer Custom");
    fs.mkdirSync(installDir, { recursive: true });

    // The whole directory, not just the .exe: a .NET apphost will not start
    // without its .dll and .runtimeconfig.json beside it.
    for (const entry of fs.readdirSync(path.dirname(HELPER))) {
      fs.copyFileSync(path.join(path.dirname(HELPER), entry), path.join(installDir, entry));
    }

    if (buildId !== undefined) {
      fs.writeFileSync(path.join(installDir, "build-id.txt"), buildId, "utf8");
    }

    const old = new Date(Date.now() - 86_400_000);
    fs.utimesSync(path.join(installDir, "computer-custom-helper.exe"), old, old);

    process.env.ProgramFiles = fakeProgramFiles;
    process.env.COMPUTER_CUSTOM_ELEVATED = "1";
    return fakeProgramFiles;
  }

  function discard(helper, dir) {
    // The helper still holds its own executable open, so it has to go first.
    helper.stop();
    fs.rmSync(dir, { force: true, recursive: true, maxRetries: 10, retryDelay: 100 });
  }

  /** The id the bundled helper was built from, as the server reads it. */
  function shippedBuildId() {
    for (const candidate of [
      path.resolve("build/helper/build-id.txt"),
      path.resolve("helper/build-id.txt"),
      path.resolve("dist/computer-custom/helper/build-id.txt"),
    ]) {
      if (fs.existsSync(candidate)) {
        return fs.readFileSync(candidate, "utf8").trim();
      }
    }
    return undefined;
  }

  it("warns when the installed elevated helper was built from other code", async () => {
    // The installed copy is signed separately and a plugin update does not
    // touch it, so elevated sessions can silently run months-old code.
    const dir = fakeInstall("0000000000000000");
    const helper = track(new HelperProcess());

    await helper.call("ping");

    assert.equal(helper.startInfo.actual, "elevated");
    assert.match(helper.startInfo.notice, /built from different code/);
    assert.match(helper.startInfo.notice, /install-elevated-helper\.ps1/);

    discard(helper, dir);
  });

  it("stays quiet when the installed helper matches, however old the file is", async (t) => {
    // The bug this replaced: the check compared modification times, so a
    // reinstall or a git checkout moved the bundled file forward and the user
    // was told every session to run an elevated installer for nothing. The
    // binary here is backdated a full day and must still pass.
    const shipped = shippedBuildId();
    if (shipped === undefined) {
      t.skip("no bundled build id; run npm run build first");
      return;
    }

    const dir = fakeInstall(shipped);
    const helper = track(new HelperProcess());

    await helper.call("ping");

    assert.equal(helper.startInfo.actual, "elevated");
    assert.equal(helper.startInfo.notice, undefined);

    discard(helper, dir);
  });

  it("stays quiet when there is no id to compare", async () => {
    // An install from before build ids existed. A question that cannot be
    // answered must not be answered with a warning.
    const dir = fakeInstall(undefined);
    const helper = track(new HelperProcess());

    await helper.call("ping");

    assert.equal(helper.startInfo.actual, "elevated");
    assert.equal(helper.startInfo.notice, undefined);

    discard(helper, dir);
  });

  it("clears start information when stopped", async () => {
    process.env.COMPUTER_CUSTOM_ELEVATED = "0";
    const helper = track(new HelperProcess({ executablePath: HELPER }));
    await helper.call("ping");
    assert.ok(helper.startInfo);

    helper.stop();

    assert.equal(helper.startInfo, undefined);
    assert.equal(helper.running, false);
  });
});
