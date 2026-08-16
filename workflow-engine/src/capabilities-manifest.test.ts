// The authoring guide is the manifest serialized for model prompts. It is
// derived from the manifest itself, so it can only drift if someone edits the
// guide's derivation — this guard asserts the guide covers the full surface:
// every engine operation, every engine state field, every infrastructure
// tool, every role, every completion contract.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authoringGuide, engineCapabilities } from "./capabilities-manifest.ts";

describe("authoring guide", () => {
  it("covers every engine operation name", () => {
    const guide = authoringGuide();
    for (const op of engineCapabilities.engineOperations) {
      assert.ok(
        guide.includes(op.name),
        `guide missing engine operation ${op.name}`
      );
      assert.ok(
        guide.includes(op.description),
        `guide missing description for engine operation ${op.name}`
      );
    }
  });

  it("covers every engine state field", () => {
    const guide = authoringGuide();
    for (const name of Object.keys(
      engineCapabilities.stateFields.engineProvided
    )) {
      assert.ok(
        guide.includes(name),
        `guide missing engine-provided field ${name}`
      );
    }
    for (const name of Object.keys(engineCapabilities.stateFields.engineRead)) {
      assert.ok(
        guide.includes(name),
        `guide missing engine-read field ${name}`
      );
    }
  });

  it("covers every infrastructure tool name", () => {
    const guide = authoringGuide();
    for (const tool of engineCapabilities.infrastructureTools) {
      assert.ok(guide.includes(tool.name), `guide missing tool ${tool.name}`);
    }
  });

  it("covers roles and completion contracts", () => {
    const guide = authoringGuide();
    for (const role of engineCapabilities.taskRoles) {
      assert.ok(guide.includes(role), `guide missing role ${role}`);
    }
    for (const contract of engineCapabilities.completionContracts) {
      assert.ok(
        guide.includes(contract.name),
        `guide missing completion contract ${contract.name}`
      );
    }
  });

  it("covers the tool/op instance-state access capability", () => {
    const guide = authoringGuide();
    assert.ok(
      guide.includes("Instance-state access in tools and ops"),
      "guide missing the instance-state access section"
    );
    assert.ok(
      guide.includes("ctx.workflowInstanceState()"),
      "guide missing the live state getter"
    );
    assert.ok(
      guide.includes("ctx.patchWorkflowInstanceState(...)"),
      "guide missing the state patch"
    );
  });

  it("covers the cross-instance write capability (E1)", () => {
    const guide = authoringGuide();
    const writes = engineCapabilities.crossInstanceWrites;
    assert.ok(guide.includes(writes.name), "guide missing patchInstanceState");
    assert.ok(
      guide.includes("writesAcross"),
      "guide missing the writesAcross declaration"
    );
    assert.ok(
      guide.includes(writes.description),
      "guide missing the cross-instance write description"
    );
  });

  it("covers the workflow-filtered instance query (E6)", () => {
    const guide = authoringGuide();
    assert.ok(
      guide.includes("workflowInstancesInState(workflowId?, stateId?)"),
      "guide missing the positional workflow-filtered query"
    );
    assert.ok(
      guide.includes('workflowInstancesInState(undefined, "done")'),
      "guide missing the state-only positional form"
    );
    assert.ok(
      guide.includes("carries the instance's workflowId"),
      "guide missing the workflowId in projections"
    );
  });

  it("covers the instance deletion capability (E5)", () => {
    const guide = authoringGuide();
    const deletion = engineCapabilities.instanceDeletion;
    assert.ok(guide.includes(deletion.name), "guide missing deletesInstance");
    assert.ok(
      guide.includes(deletion.description),
      "guide missing the deletion description"
    );
    assert.ok(
      guide.includes("removeWorkflowInstance"),
      "guide missing the runtime remove capability"
    );
  });

  it("covers the board grouping capability (E3)", () => {
    const guide = authoringGuide();
    const grouping = engineCapabilities.boardGrouping;
    assert.ok(guide.includes(grouping.name), "guide missing groupByField");
    assert.ok(
      guide.includes("Uncategorized"),
      "guide missing the uncategorized column"
    );
    assert.ok(
      guide.includes("never reads or interprets"),
      "guide missing the generic-partition guarantee"
    );
  });

  it("covers the flowState capability (E2)", () => {
    const guide = authoringGuide();
    const flowState = engineCapabilities.flowState;
    assert.ok(guide.includes(flowState.name), "guide missing flowState");
    assert.ok(
      guide.includes("ctx.flowState()"),
      "guide missing the flowState read"
    );
    assert.ok(
      guide.includes("ctx.patchFlowState"),
      "guide missing the flowState write"
    );
    assert.ok(
      guide.includes("toFlowState edge transforms against the declaration"),
      "guide missing the flowState write validation"
    );
    assert.ok(
      guide.includes("toFlowState"),
      "guide missing the toFlowState edge"
    );
  });

  it("covers the runtime edit-field options capability (E4)", () => {
    const guide = authoringGuide();
    const options = engineCapabilities.runtimeEditOptions;
    assert.ok(guide.includes(options.name), "guide missing optionsFrom");
    assert.ok(
      guide.includes("optionsFrom: { flowState"),
      "guide missing the optionsFrom shape"
    );
    assert.ok(
      guide.includes("falls back to free text"),
      "guide missing the free-text fallback"
    );
  });
});
