import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { listFlows, runFlow } from "../build/server/flows.mjs";

const directories = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

function makeFlowsDir(files) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-flows-"));
  directories.push(directory);
  for (const [name, source] of Object.entries(files)) {
    fs.writeFileSync(path.join(directory, name), source, "utf8");
  }

  return directory;
}

/** Stands in for the gated tool dispatcher. */
function recordingInvoker(behaviour = {}) {
  const calls = [];
  const invoke = async (name, args) => {
    calls.push({ name, args });
    const reply = behaviour[name];
    if (reply === "error") {
      return { content: [{ type: "text", text: "Blocked by policy" }], isError: true };
    }

    return { content: [{ type: "text", text: JSON.stringify(reply ?? { ok: true, name }) }] };
  };

  return { invoke, calls };
}

describe("flow discovery", () => {
  it("lists flows with their descriptions", async () => {
    const directory = makeFlowsDir({
      "login.mjs": 'export const description = "Signs in";\nexport default async () => {};\n',
      "cleanup.js": 'export const description = "Removes leftovers";\nexport default async () => {};\n',
      "notes.txt": "ignored",
    });

    const flows = await listFlows(directory);

    assert.deepEqual(
      flows.map((flow) => [flow.name, flow.description]),
      [
        ["cleanup", "Removes leftovers"],
        ["login", "Signs in"],
      ],
    );
  });

  it("returns nothing for a directory that does not exist", async () => {
    assert.deepEqual(await listFlows(path.join(os.tmpdir(), "cc-flows-missing-xyz")), []);
  });
});

describe("running a flow", () => {
  it("passes tool calls through the invoker and returns the result", async () => {
    const directory = makeFlowsDir({
      "shot.mjs": `export default async (cc) => {
        const windows = await cc.list_windows();
        cc.log("saw " + windows.length + " windows");
        await cc.click({ x: 1, y: 2 });
        return { seen: windows.length };
      };\n`,
    });
    const { invoke, calls } = recordingInvoker({ list_windows: [1, 2, 3] });

    const result = await runFlow(directory, "shot", {}, invoke);

    assert.equal(result.ok, true);
    assert.deepEqual(result.result, { seen: 3 });
    assert.deepEqual(result.logs, ["saw 3 windows"]);
    assert.deepEqual(
      calls.map((call) => call.name),
      ["list_windows", "click"],
    );
  });

  it("gives the flow its arguments", async () => {
    const directory = makeFlowsDir({
      "echo.mjs": "export default async (cc) => cc.args;\n",
    });
    const { invoke } = recordingInvoker();

    const result = await runFlow(directory, "echo", { user: "tester" }, invoke);

    assert.deepEqual(result.result, { user: "tester" });
  });

  it("stops the flow when a tool is refused", async () => {
    // The gate must actually halt a script, not be something it can ignore.
    const directory = makeFlowsDir({
      "risky.mjs": `export default async (cc) => {
        await cc.run_shell({ command: "whatever" });
        cc.log("should not get here");
        return "finished";
      };\n`,
    });
    const { invoke, calls } = recordingInvoker({ run_shell: "error" });

    const result = await runFlow(directory, "risky", {}, invoke);

    assert.equal(result.ok, false);
    assert.match(result.error, /run_shell failed: Blocked by policy/);
    assert.deepEqual(result.logs, []);
    assert.equal(calls.length, 1);
  });

  it("reports a flow that throws", async () => {
    const directory = makeFlowsDir({
      "boom.mjs": 'export default async () => { throw new Error("kaboom"); };\n',
    });

    const result = await runFlow(directory, "boom", {}, recordingInvoker().invoke);

    assert.equal(result.ok, false);
    assert.match(result.error, /kaboom/);
  });

  it("rejects a file that exports no function", async () => {
    const directory = makeFlowsDir({ "bad.mjs": "export const description = 'nope';\n" });

    const result = await runFlow(directory, "bad", {}, recordingInvoker().invoke);

    assert.equal(result.ok, false);
    assert.match(result.error, /export default/);
  });

  it("names the available flows when one is missing", async () => {
    const directory = makeFlowsDir({ "login.mjs": "export default async () => {};\n" });

    const result = await runFlow(directory, "nope", {}, recordingInvoker().invoke);

    assert.equal(result.ok, false);
    assert.match(result.error, /Available: login/);
  });

  it("does not let a flow name escape the flows directory", async () => {
    const directory = makeFlowsDir({ "safe.mjs": "export default async () => {};\n" });
    const outside = path.join(directory, "..", "outside.mjs");
    fs.writeFileSync(outside, 'export default async () => "escaped";\n', "utf8");

    try {
      const result = await runFlow(directory, "../outside", {}, recordingInvoker().invoke);

      assert.equal(result.ok, false);
      assert.notEqual(result.result, "escaped");
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  it("picks up an edited flow rather than a cached one", async () => {
    const directory = makeFlowsDir({ "v.mjs": 'export default async () => "first";\n' });
    const invoker = recordingInvoker().invoke;

    assert.equal((await runFlow(directory, "v", {}, invoker)).result, "first");

    fs.writeFileSync(path.join(directory, "v.mjs"), 'export default async () => "second";\n', "utf8");

    assert.equal((await runFlow(directory, "v", {}, invoker)).result, "second");
  });
});
