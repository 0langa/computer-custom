import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { Overlay } from "../build/server/overlay.mjs";
import { HelperProcess } from "../build/server/helper-process.mjs";
import { BatchCoordinator } from "../build/server/batch-coordinator.mjs";

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
  it("routes snooze and cancel events with the correct batch identity", () => {
    const events=[];
    const overlay=track(new Overlay({onSnooze:id=>events.push(['snooze',id]),onCancel:id=>events.push(['cancel',id])}));
    overlay.handleEvent('{"event":"snooze","batchId":"one"}');
    overlay.handleEvent('{"event":"cancel","batchId":"two"}');
    assert.deepEqual(events,[['snooze','one'],['cancel','two']]);
  });
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
      overlay.stop();
    });
    assert.equal(overlay.running, false);
  });

  it("accepts state calls before it has started", () => {
    delete process.env.COMPUTER_CUSTOM_OVERLAY;
    const overlay = track(new Overlay({ executablePath: OVERLAY }));

    assert.doesNotThrow(() => {
      overlay.setState("observing");
    });
  });
});

describe("overlay process", { skip: !fs.existsSync(OVERLAY) && "overlay not built" }, () => {
  it("the real Snooze button defers batches from two owners", async () => {
    delete process.env.COMPUTER_CUSTOM_OVERLAY;
    const previousMode=process.env.COMPUTER_CUSTOM_ELEVATED;process.env.COMPUTER_CUSTOM_ELEVATED='0';
    const helper=new HelperProcess({executablePath:path.resolve('dist/computer-custom/helper/computer-custom-helper.exe')});
    let coordinator,resolveShown,resolveSnoozed;
    const shown=new Promise(resolve=>resolveShown=resolve);
    const snoozed=new Promise(resolve=>resolveSnoozed=resolve);
    const overlay=track(new Overlay({executablePath:OVERLAY,onSnooze:()=>resolveSnoozed(coordinator.snooze())}));
    coordinator=new BatchCoordinator({run:async()=>assert.fail('snoozed fixture must not take over'),
      showNotice:async batch=>{resolveShown(await overlay.showNotice({batchId:batch.id,title:'Snooze wiring test',actions:batch.actions.length,
        ...batch.settings,x:-1800,y:400}));},hideNotice:batch=>overlay.hideNotice(batch.id).then(()=>{})});
    const actions=Array.from({length:2},()=>({op:'click',target:{handle:1,pid:2,processStartTime:'3'},args:{x:1,y:1}}));
    const a=coordinator.prepare('a',{actions,flush:true}),b=coordinator.prepare('b',{actions,flush:true});
    try {
      const notice=await shown;
      const tree=(await helper.call('ui_tree',{handle:notice.handle,interactiveOnly:false})).result;
      const flatten=node=>[node,...node.children.flatMap(flatten)];
      const button=flatten(tree.root).find(node=>node.automationId==='snooze');
      assert.ok(button,'visible snooze button exposed through native accessibility');
      await helper.call('invoke_element',{elementId:button.elementId,prepared:true,target:tree.target});
      const resumeAt=await Promise.race([snoozed,sleep(2000).then(()=>{throw new Error('Snooze event missing');})]);
      assert.equal(coordinator.status('a',a.id).state,'snoozed');
      assert.equal(coordinator.status('a',a.id).resumeAt,resumeAt);
      assert.equal(coordinator.status('b',b.id).resumeAt,resumeAt);
    } finally {
      coordinator.disconnect('a');coordinator.disconnect('b');helper.stop();
      if(previousMode===undefined)delete process.env.COMPUTER_CUSTOM_ELEVATED;else process.env.COMPUTER_CUSTOM_ELEVATED=previousMode;
    }
  });
  it("acknowledges a visible countdown and hides it before input begins", async () => {
    delete process.env.COMPUTER_CUSTOM_OVERLAY;
    const overlay=track(new Overlay({executablePath:OVERLAY}));
    const shown=await overlay.showNotice({batchId:'notice-fixture',title:'Notification test',actions:5,countdownMs:15000,maxControlMs:10000,
      inputMode:'block',x:-1800,y:400});
    assert.equal(shown.batchId,'notice-fixture');
    assert.equal(shown.visible,true);
    assert.ok(shown.handle>0);
    const hidden=await overlay.hideNotice('notice-fixture');
    assert.equal(hidden.visible,false);
  });
  it("starts, accepts commands, and stops", async () => {
    delete process.env.COMPUTER_CUSTOM_OVERLAY;
    const overlay = track(new Overlay({ executablePath: OVERLAY }));

    overlay.start();
    assert.equal(overlay.running, true);

    await sleep(900);
    overlay.setState("observing");
    overlay.setState("acting");
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
