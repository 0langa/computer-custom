import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveSkyMethod,
  HOOK_TOOL_PREFIX,
} from "../dist/computer-custom/scripts/computer-use-guard.mjs";

describe("resolveSkyMethod", () => {
  it("ignores non computer-use tools", () => {
    assert.equal(resolveSkyMethod("Bash"), null);
    assert.equal(resolveSkyMethod("mcp__memory__create_entities"), null);
  });

  it("maps click-family tools to click", () => {
    for (const tool of [
      "left_click",
      "double_click",
      "triple_click",
      "middle_click",
      "left_click_drag",
      "left_mouse_down",
      "left_mouse_up",
    ]) {
      assert.equal(resolveSkyMethod(`${HOOK_TOOL_PREFIX}${tool}`), "click");
    }
  });

  it("maps right_click to perform_secondary_action", () => {
    assert.equal(
      resolveSkyMethod(`${HOOK_TOOL_PREFIX}right_click`),
      "perform_secondary_action",
    );
  });

  it("maps key input tools", () => {
    assert.equal(resolveSkyMethod(`${HOOK_TOOL_PREFIX}key`), "press_key");
    assert.equal(resolveSkyMethod(`${HOOK_TOOL_PREFIX}hold_key`), "press_key");
    assert.equal(resolveSkyMethod(`${HOOK_TOOL_PREFIX}type`), "type_text");
  });

  it("falls back to the raw suffix for unmapped tools", () => {
    assert.equal(resolveSkyMethod(`${HOOK_TOOL_PREFIX}screenshot`), "screenshot");
    assert.equal(resolveSkyMethod(`${HOOK_TOOL_PREFIX}scroll`), "scroll");
  });
});
