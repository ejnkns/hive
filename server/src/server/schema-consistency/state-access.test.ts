/** @private — the state-access extraction collectors are receiver-aware: a
 * patch write counts only when it is performed on the `ctx` context argument
 * (ctx.patchWorkflowInstanceState / ctx.patchInstanceState / ctx.patchFlowState),
 * including the optional-chaining form. A patch on any other receiver (e.g.
 * `task.`, where task is a TaskDefinition with no state methods) must not be
 * counted as a writer — it is a bug, not a declared write. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type ts from "typescript";
import { parseFile } from "./ast.ts";
import {
  collectFlowStatePatchWrites,
  collectPatchWrites,
  collectSiblingPatchWrites,
} from "./state-access.ts";

function writesOf(
  source: string,
  collect: (fn: ts.Node, out: Set<string>) => void
): string[] {
  const file = parseFile({ path: "test.ts", source });
  const out = new Set<string>();
  collect(file, out);
  return [...out].sort();
}

describe("state-access write extraction (receiver-aware)", () => {
  it("collects own-instance patches only from ctx, including optional chaining", () => {
    assert.deepEqual(
      writesOf(
        `ctx.patchWorkflowInstanceState({ sessionBrief: "x" });
task.patchWorkflowInstanceState({ bogus: "y" });
ctx.patchWorkflowInstanceState?.({ attempt: 1 });`,
        collectPatchWrites
      ),
      ["attempt", "sessionBrief"]
    );
  });

  it("collects sibling patches only from ctx.patchInstanceState", () => {
    assert.deepEqual(
      writesOf(
        `ctx.patchInstanceState(id, { category: "launch" });
task.patchInstanceState(id, { bogus: "x" });`,
        collectSiblingPatchWrites
      ),
      ["category"]
    );
  });

  it("collects flowState patches only from ctx.patchFlowState", () => {
    assert.deepEqual(
      writesOf(
        `ctx.patchFlowState({ taxonomy: [] });
task.patchFlowState({ bogus: 1 });`,
        collectFlowStatePatchWrites
      ),
      ["taxonomy"]
    );
  });
});
