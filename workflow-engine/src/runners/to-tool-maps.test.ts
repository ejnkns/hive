import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toToolMaps } from "./to-tool-maps.ts";
import type { Tool } from "./tool-types.ts";

function makeTool(name: string): Tool {
  return {
    definition: {
      type: "function",
      function: {
        name,
        description: `Tool ${name}`,
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    executor: async (call) => ({
      toolCallId: call.id,
      content: "ok",
      isError: false,
    }),
  };
}

describe("toToolMaps", () => {
  it("splits a tool list into name-keyed definition and executor maps", () => {
    const tool = makeTool("submit_work");
    const { definitions, executors } = toToolMaps([tool]);

    assert.ok("submit_work" in definitions);
    assert.ok("submit_work" in executors);
    assert.equal(definitions.submit_work.function.name, "submit_work");
    assert.equal(typeof executors.submit_work, "function");
  });

  it("keys by definition.function.name, not the bundle position", () => {
    const { definitions } = toToolMaps([makeTool("alpha"), makeTool("beta")]);
    assert.deepEqual(Object.keys(definitions).sort(), ["alpha", "beta"]);
  });

  it("throws on duplicate tool names", () => {
    assert.throws(
      () => toToolMaps([makeTool("dup"), makeTool("dup")]),
      /Duplicate tool name: dup/
    );
  });

  it("returns empty maps for an empty list", () => {
    const { definitions, executors } = toToolMaps([]);
    assert.deepEqual(definitions, {});
    assert.deepEqual(executors, {});
  });
});
