import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { defineWorkflow } from "workflow-engine/workflow-types";
import {
  deleteUserDefinition,
  registerFlowDefinition,
  registerUserDefinition,
  resetFlowDefinitionsForTest,
  setDefinitionsBasePathForTest,
  updateUserDefinition,
} from "./flow-definitions";
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
  let definitionsDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join("/tmp", "flow-registry-test-"));
    definitionsDir = mkdtempSync(join("/tmp", "flow-definitions-test-"));
    setDefinitionsBasePathForTest(definitionsDir);
    resetFlowDefinitionsForTest();
    setFlowPersistence(createFlowPersistence(dir));
    registerFlowDefinition(testDefinition);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(definitionsDir, { recursive: true, force: true });
  });

  it("createFlow seeds and persists an initial instance", () => {
    const persistence = getFlowPersistence()!;
    createFlow("flow-a", "test-def", persistence);

    const persisted = persistence.loadFlow("flow-a");
    assert.ok(persisted);
    assert.equal(persisted.instances.length, 1);
    assert.equal(persisted.instances[0]!.state.currentState, "idle");
  });

  it("rehydrateFlow rebuilds a runtime from its registered definition", async () => {
    const persistence = getFlowPersistence()!;
    createFlow("flow-a", "test-def", persistence);

    const persisted = persistence.loadFlow("flow-a")!;
    const runtime = await rehydrateFlow(
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

  it("rehydrateFlow returns null for an unknown definition id", async () => {
    const persistence = getFlowPersistence()!;
    const runtime = await rehydrateFlow(
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

  it("rehydrate uses the creation-time snapshot, not a later definition edit", async () => {
    const persistence = getFlowPersistence()!;
    const source = `
import { defineWorkflow } from "workflow-engine/workflow-types";

const wf = defineWorkflow({
  id: "wf",
  label: "Workflow",
  taskOutputs: {} as Record<string, never>,
  states: [
    { id: "idle", label: "Original Label", category: "initial" },
    { id: "done", label: "Done", category: "terminal" },
  ],
  initial: "idle",
  terminalStates: ["done"],
});

export const flow = {
  id: "snap-definition",
  label: "Snap Definition",
  workflows: [wf],
  edges: [],
};
`;
    await registerUserDefinition({ name: "Snap Definition", source });
    createFlow("snap-flow", "snap-definition", persistence, {
      name: "Snap Flow",
    });

    await updateUserDefinition("snap-definition", {
      name: "Snap Definition",
      source: source.replace("Original Label", "Edited Label"),
    });

    const persisted = persistence.loadFlow("snap-flow")!;
    const runtime = await rehydrateFlow(
      persistence,
      "snap-flow",
      persisted.config,
      persisted.state,
      persisted.instances
    );

    assert.ok(runtime);
    const workflows = runtime.getWorkflowDefinitions();
    assert.equal(workflows[0]!.states[0]!.label, "Original Label");
  });

  it("rehydrate uses the snapshot even when the definition is deleted", async () => {
    const persistence = getFlowPersistence()!;
    const source = `
import { defineWorkflow } from "workflow-engine/workflow-types";

const wf = defineWorkflow({
  id: "wf",
  label: "Workflow",
  taskOutputs: {} as Record<string, never>,
  states: [
    { id: "idle", label: "Kept Label", category: "initial" },
    { id: "done", label: "Done", category: "terminal" },
  ],
  initial: "idle",
  terminalStates: ["done"],
});

export const flow = {
  id: "gone-definition",
  label: "Gone Definition",
  workflows: [wf],
  edges: [],
};
`;
    await registerUserDefinition({ name: "Gone Definition", source });
    createFlow("gone-flow", "gone-definition", persistence, {
      name: "Gone Flow",
    });

    deleteUserDefinition("gone-definition");

    const persisted = persistence.loadFlow("gone-flow")!;
    const runtime = await rehydrateFlow(
      persistence,
      "gone-flow",
      persisted.config,
      persisted.state,
      persisted.instances
    );

    assert.ok(runtime);
    const workflows = runtime.getWorkflowDefinitions();
    assert.equal(workflows[0]!.states[0]!.label, "Kept Label");
  });
});
