import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { defineWorkflow } from "workflow-engine/workflow-types";
import { registerFlowDefinition } from "./flow-definitions";
import { createFlowPersistence } from "./flow-persistence";
import {
  createFlow,
  getFlowPersistence,
  getFlowRuntime,
  rehydrateFlow,
  setFlowPersistence,
  unlinkFlow,
} from "./flow-registry";

const testWorkflow = defineWorkflow({
  id: "test-wf",
  label: "Test Workflow",
  taskOutputs: {} as Record<string, never>,
  states: [
    { id: "idle", label: "Idle", category: "initial" },
    { id: "done", label: "Done", category: "terminal" },
  ],
  initial: "idle",
  terminalStates: ["done"],
});

const testDefinition = {
  id: "test-def",
  label: "Test Definition",
  workflows: [testWorkflow],
  edges: [],
};

describe("flow-registry", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join("/tmp", "flow-registry-test-"));
    setFlowPersistence(createFlowPersistence(dir));
    registerFlowDefinition(testDefinition);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("createFlow seeds and persists an initial instance", () => {
    const persistence = getFlowPersistence()!;
    createFlow("flow-a", "test-def", persistence);

    const persisted = persistence.loadFlow("flow-a");
    assert.ok(persisted);
    assert.equal(persisted.instances.length, 1);
    assert.equal(persisted.instances[0]!.state.currentState, "idle");
  });

  it("rehydrateFlow rebuilds a runtime from its registered definition", () => {
    const persistence = getFlowPersistence()!;
    createFlow("flow-a", "test-def", persistence);

    const persisted = persistence.loadFlow("flow-a")!;
    const runtime = rehydrateFlow(
      persistence,
      "flow-a",
      persisted.config,
      persisted.state,
      persisted.instances
    );

    assert.ok(runtime);
    assert.equal(runtime.workflowInstances.length, 1);
    assert.equal(runtime.workflowInstances[0]!.currentState, "idle");
    assert.equal(getFlowRuntime("flow-a"), runtime);
  });

  it("rehydrateFlow returns null for an unknown definition id", () => {
    const persistence = getFlowPersistence()!;
    const runtime = rehydrateFlow(
      persistence,
      "flow-b",
      { definitionId: "missing-def", name: "flow-b" },
      {},
      []
    );
    assert.equal(runtime, null);
  });

  it("unlinkFlow removes the flow from persistence and the runtime map", () => {
    const persistence = getFlowPersistence()!;
    createFlow("flow-a", "test-def", persistence);

    unlinkFlow("flow-a");

    assert.equal(getFlowRuntime("flow-a"), undefined);
    assert.equal(persistence.loadFlow("flow-a"), null);
  });
});
