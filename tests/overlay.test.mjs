import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { Overlay } from "../build/server/overlay.mjs";

const OVERLAY = path.resolve(
  "helper/ComputerCustom.Overlay/bin/Debug/net10.0-windows/computer-custom-overlay.exe",
);

const started = [];
const original = process.env.COMPUTER_CUSTOM_OVERLAY;

afterEach(() => {
  for (const overlay of started.splice(0)) {
    overlay.stop();
  }

  if (original === undefined) {
    delete process.env.COMPUTER_CUSTOM_OVERLAY;
  } else {
    process.env.COMPUTER_CUSTOM_OVERLAY = original;
  }
});

function track(overlay) {
  started.push(overlay);
  return overlay;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe("overlay lifecycle", () => {
  it("is on by default", () => {
    delete process.env.COMPUTER_CUSTOM_OVERLAY;

    // Seeing what the agent is doing is the point of the feature, so it has to
    // be opted out of rather than into.
    assert.equal(track(new Overlay()).enabled, true);
  });

  it("can be switched off", () => {
    for (const value of ["0", "false", "FALSE"]) {
      process.env.COMPUTER_CUSTOM_OVERLAY = value;
      assert.equal(track(new Overlay()).enabled, false, `${value} should disable it`);
    }
  });

  it("does not spawn anything when disabled", () => {
    process.env.COMPUTER_CUSTOM_OVERLAY = "0";
    const overlay = track(new Overlay({ executablePath: OVERLAY }));

    overlay.start();

    assert.equal(overlay.running, false);
  });

  it("tolerates an executable that does not exist", () => {
    delete process.env.COMPUTER_CUSTOM_OVERLAY;
    const overlay = track(new Overlay({ executablePath: "C:/nope/missing-overlay.exe" }));

    // A missing overlay costs the user a visual cue. It must never cost them
    // the plugin, so none of this may throw.
    assert.doesNotThrow(() => {
      overlay.start();
      overlay.setState("acting");
      overlay.ripple(10, 20);
      overlay.stop();
    });
    assert.equal(overlay.running, false);
  });

  it("accepts state and ripple calls before it has started", () => {
    delete process.env.COMPUTER_CUSTOM_OVERLAY;
    const overlay = track(new Overlay({ executablePath: OVERLAY }));

    assert.doesNotThrow(() => {
      overlay.setState("observing");
      overlay.ripple(1, 1);
    });
  });
});

describe("overlay process", { skip: !fs.existsSync(OVERLAY) && "overlay not built" }, () => {
  it("starts, accepts commands, and stops", async () => {
    delete process.env.COMPUTER_CUSTOM_OVERLAY;
    const overlay = track(new Overlay({ executablePath: OVERLAY }));

    overlay.start();
    assert.equal(overlay.running, true);

    await sleep(900);
    overlay.setState("observing");
    overlay.setState("acting");
    overlay.ripple(400, 400);
    await sleep(300);

    overlay.stop();
    assert.equal(overlay.running, false);
  });

  it("starts only once however often start is called", () => {
    delete process.env.COMPUTER_CUSTOM_OVERLAY;
    const overlay = track(new Overlay({ executablePath: OVERLAY }));

    overlay.start();
    overlay.start();
    overlay.start();

    assert.equal(overlay.running, true);
  });

  it("ignores noise on the event channel", () => {
    delete process.env.COMPUTER_CUSTOM_OVERLAY;
    let panicked = false;
    const overlay = track(new Overlay({ onPanic: () => { panicked = true; } }));

    // The overlay is a separate process, so its output is not a trusted source
    // of structure. Nothing here may throw, and nothing may trigger a halt.
    for (const line of ["", "not json", "{}", '{"event":"other"}', "[1,2,3]"]) {
      assert.doesNotThrow(() => overlay.handleEvent(line));
    }

    assert.equal(panicked, false);
  });

  it("reports a panic from the overlay to the caller", async () => {
    delete process.env.COMPUTER_CUSTOM_OVERLAY;
    let panicked = false;
    const overlay = track(
      new Overlay({ executablePath: OVERLAY, onPanic: () => { panicked = true; } }),
    );

    overlay.start();
    await sleep(900);

    // The real trigger is a hotkey the user presses; this checks the wiring
    // from the overlay's output through to the callback that halts a session.
    overlay.handleEvent('{"event":"panic"}');

    assert.equal(panicked, true);
  });
});
