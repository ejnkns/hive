import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { FlowPersistence } from "workflow-engine/create-flow-runtime";
import {
  defineWorkflow,
  type FlowDefinition,
} from "workflow-engine/workflow-types";
import {
  deleteUserDefinition,
  registerFlowDefinition,
  registerUserDefinition,
  resetFlowDefinitionsForTest,
  setDefinitionsBasePathForTest,
  updateUserDefinition,
} from "./flow-definitions";
import { createFlowPersistence } from "./flow-persistence";
import type { FlowEventBusEvent } from "./flow-registry";
import {
  createFlow,
  dispatchFlowLevelAction,
  getAvailableFlowActions,
  getFlowPersistence,
  getFlowRuntime,
  onFlowEvent,
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
    const persistence = getFlowPersistence();
    assert.ok(persistence);
    createFlow("flow-a", "test-def", persistence);

    const persisted = persistence.loadFlow("flow-a");
    assert.ok(persisted);
    assert.equal(persisted.instances.length, 1);
    assert.equal(persisted.instances[0].state.currentState, "idle");
  });

  it("rehydrateFlow rebuilds a runtime from its registered definition", async () => {
    const persistence = getFlowPersistence();
    assert.ok(persistence);
    createFlow("flow-a", "test-def", persistence);

    const persisted = persistence.loadFlow("flow-a");
    assert.ok(persisted);
    const runtime = await rehydrateFlow(
      persistence,
      "flow-a",
      persisted.config,
      persisted.state,
      persisted.instances
    );

    assert.ok(runtime);
    assert.equal(runtime.workflowInstances.length, 1);
    assert.equal(runtime.workflowInstances[0].currentState, "idle");
    assert.equal(getFlowRuntime("flow-a"), runtime);
  });

  it("rehydrateFlow returns null for an unknown definition id", async () => {
    const persistence = getFlowPersistence();
    assert.ok(persistence);
    const runtime = await rehydrateFlow(
      persistence,
      "flow-b",
      { definitionId: "missing-def", name: "flow-b" },
      {},
      []
    );
    assert.equal(runtime, null);
  });

  it("onFlowEvent emits flow_event for a runtime created after subscription", () => {
    const persistence = getFlowPersistence();
    assert.ok(persistence);
    const events: FlowEventBusEvent[] = [];
    const unsubscribe = onFlowEvent((event) => events.push(event));
    try {
      createFlow("flow-a", "test-def", persistence);
      assert.ok(
        events.some(
          (event) => event.type === "flow_event" && event.flowId === "flow-a"
        ),
        "createFlow events should reach a subscriber"
      );
    } finally {
      unsubscribe();
    }
  });

  it("onFlowEvent emits flow_event for a rehydrated runtime", async () => {
    const persistence = getFlowPersistence();
    assert.ok(persistence);
    createFlow("flow-a", "test-def", persistence);

    const persisted = persistence.loadFlow("flow-a");
    assert.ok(persisted);

    const events: FlowEventBusEvent[] = [];
    const unsubscribe = onFlowEvent((event) => events.push(event));
    try {
      const runtime = await rehydrateFlow(
        persistence,
        "flow-a",
        persisted.config,
        persisted.state,
        persisted.instances
      );
      assert.ok(runtime);
      assert.ok(
        events.some(
          (event) => event.type === "flow_event" && event.flowId === "flow-a"
        ),
        "rehydrate events should reach a subscriber"
      );
    } finally {
      unsubscribe();
    }
  });

  it("onFlowEvent emits flow_deleted on unlink", () => {
    const persistence = getFlowPersistence();
    assert.ok(persistence);
    createFlow("flow-a", "test-def", persistence);

    const events: FlowEventBusEvent[] = [];
    const unsubscribe = onFlowEvent((event) => events.push(event));
    try {
      unlinkFlow("flow-a");
      assert.ok(
        events.some(
          (event) => event.type === "flow_deleted" && event.flowId === "flow-a"
        ),
        "unlink should emit flow_deleted"
      );
    } finally {
      unsubscribe();
    }
  });

  it("unlinkFlow removes the flow from persistence and the runtime map", () => {
    const persistence = getFlowPersistence();
    assert.ok(persistence);
    createFlow("flow-a", "test-def", persistence);

    unlinkFlow("flow-a");

    assert.equal(getFlowRuntime("flow-a"), undefined);
    assert.equal(persistence.loadFlow("flow-a"), null);
  });

  it("rehydrateFlow restores instances under their original ids without duplicating files", async () => {
    const persistence = getFlowPersistence();
    assert.ok(persistence);
    createFlow("flow-a", "test-def", persistence);

    const before = persistence.loadFlow("flow-a");
    assert.ok(before);
    const beforeIds = before.instances.map((instance) => instance.instanceId);
    assert.equal(before.instances.length, 1);

    const runtime = await rehydrateFlow(
      persistence,
      "flow-a",
      before.config,
      before.state,
      before.instances
    );
    assert.ok(runtime);
    assert.equal(runtime.workflowInstances.length, 1);

    const after = persistence.loadFlow("flow-a");
    assert.ok(after);
    assert.deepEqual(
      after.instances.map((instance) => instance.instanceId),
      beforeIds
    );
    assert.equal(after.instances.length, 1);
  });

  it("rehydrate uses the creation-time snapshot, not a later definition edit", async () => {
    const persistence = getFlowPersistence();
    assert.ok(persistence);
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

    const persisted = persistence.loadFlow("snap-flow");
    assert.ok(persisted);
    const runtime = await rehydrateFlow(
      persistence,
      "snap-flow",
      persisted.config,
      persisted.state,
      persisted.instances
    );

    assert.ok(runtime);
    const workflows = runtime.getWorkflowDefinitions();
    assert.equal(workflows[0].states[0].label, "Original Label");
  });

  it("rehydrate uses the snapshot even when the definition is deleted", async () => {
    const persistence = getFlowPersistence();
    assert.ok(persistence);
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

    const persisted = persistence.loadFlow("gone-flow");
    assert.ok(persisted);
    const runtime = await rehydrateFlow(
      persistence,
      "gone-flow",
      persisted.config,
      persisted.state,
      persisted.instances
    );

    assert.ok(runtime);
    const workflows = runtime.getWorkflowDefinitions();
    assert.equal(workflows[0].states[0].label, "Kept Label");
  });
});

// ─── Flow-level action fixtures ───

const itemWorkflow = defineWorkflow({
  id: "item",
  label: "Item",
  taskOutputs: {} as Record<string, never>,
  states: [
    {
      id: "ready",
      label: "Ready",
      category: "initial",
      actions: [{ id: "finish", label: "Finish", transitionTo: "done" }],
    },
    { id: "done", label: "Done", category: "terminal" },
  ],
  initial: "ready",
  terminalStates: ["done"],
});

const actionDefinition = {
  id: "action-def",
  label: "Action Definition",
  workflows: [itemWorkflow],
  edges: [],
  actions: [
    {
      id: "add_item",
      label: "Add item",
      variant: "primary",
      createInstance: {
        workflowId: "item",
        fields: [
          { key: "title", label: "Title", type: "string", required: true },
          { key: "count", label: "Count", type: "number" },
        ],
      },
    },
    {
      id: "approve_all",
      label: "Approve all",
      dispatchToAll: { workflowId: "item", actionId: "finish" },
    },
    {
      id: "gated",
      label: "Gated",
      gate: () => false,
      createInstance: { workflowId: "item" },
    },
  ],
} satisfies FlowDefinition;

describe("flow-level actions", () => {
  let dir: string;
  let definitionsDir: string;
  let persistence: FlowPersistence;

  beforeEach(() => {
    dir = mkdtempSync(join("/tmp", "flow-actions-test-"));
    definitionsDir = mkdtempSync(join("/tmp", "flow-definitions-test-"));
    setDefinitionsBasePathForTest(definitionsDir);
    resetFlowDefinitionsForTest();
    setFlowPersistence(createFlowPersistence(dir));
    const current = getFlowPersistence();
    assert.ok(current);
    persistence = current;
    registerFlowDefinition(actionDefinition);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(definitionsDir, { recursive: true, force: true });
  });

  it("getAvailableFlowActions returns gate-passing actions with variants", () => {
    createFlow("flow-a", "action-def", persistence);
    const actions = getAvailableFlowActions("flow-a");
    assert.deepEqual(
      actions.map((a) => ({ id: a.id, variant: a.variant })),
      [
        { id: "add_item", variant: "primary" },
        { id: "approve_all", variant: "default" },
      ]
    );
  });

  it("dispatchFlowLevelAction createInstance seeds a new instance with the form payload", () => {
    createFlow("flow-a", "action-def", persistence);
    const result = dispatchFlowLevelAction("flow-a", "add_item", {
      title: "New idea",
      count: 3,
    });

    assert.equal(result.kind, "create_instance");
    const created = runtimeEntries("flow-a").find(
      (entry) => entry.id === result.instance.id
    );
    assert.ok(created);
    assert.deepEqual(created.state.workflowInstanceState, {
      title: "New idea",
      count: 3,
    });
  });

  it("createInstance rejects unknown fields", () => {
    createFlow("flow-a", "action-def", persistence);
    assert.throws(
      () => dispatchFlowLevelAction("flow-a", "add_item", { bogus: 1 }),
      /Unknown field "bogus"/
    );
  });

  it("createInstance requires required fields and checks types", () => {
    createFlow("flow-a", "action-def", persistence);
    assert.throws(
      () => dispatchFlowLevelAction("flow-a", "add_item", {}),
      /Missing required field "title"/
    );
    assert.throws(
      () =>
        dispatchFlowLevelAction("flow-a", "add_item", {
          title: "X",
          count: "two",
        }),
      /must be a number/
    );
  });

  it("dispatchToAll dispatches the target action to every eligible instance", () => {
    createFlow("flow-a", "action-def", persistence);
    const runtime = getFlowRuntime("flow-a");
    assert.ok(runtime);
    runtime.addWorkflowInstance("item");

    const before = runtimeEntries("flow-a");
    assert.equal(before.length, 2);
    assert.ok(before.every((entry) => entry.state.currentState === "ready"));

    const result = dispatchFlowLevelAction("flow-a", "approve_all", {});
    assert.equal(result.kind, "dispatch_to_all");
    assert.equal(result.dispatched.length, 2);
    assert.ok(
      runtimeEntries("flow-a").every(
        (entry) => entry.state.currentState === "done"
      )
    );
  });

  it("dispatchFlowLevelAction respects a failing gate", () => {
    createFlow("flow-a", "action-def", persistence);
    assert.throws(
      () => dispatchFlowLevelAction("flow-a", "gated", {}),
      /not available/
    );
  });

  it("dispatchFlowLevelAction throws for an unknown action", () => {
    createFlow("flow-a", "action-def", persistence);
    assert.throws(
      () => dispatchFlowLevelAction("flow-a", "missing", {}),
      /not found/
    );
  });

  it("dispatchFlowLevelAction throws for an unknown flow", () => {
    assert.throws(
      () => dispatchFlowLevelAction("nope", "add_item", {}),
      /Flow not found/
    );
  });

  it("createFlow threads integrationBranch and branchPrefix into flow config", () => {
    createFlow("flow-a", "action-def", persistence, {
      name: "Git Flow",
      integrationBranch: "integ",
      branchPrefix: "hive/",
    });

    const runtime = getFlowRuntime("flow-a");
    assert.ok(runtime);
    const config = runtime.getFlowConfig();
    assert.equal(config.integrationBranch, "integ");
    assert.equal(config.branchPrefix, "hive/");
  });

  function runtimeEntries(flowId: string) {
    const runtime = getFlowRuntime(flowId);
    assert.ok(runtime);
    return runtime.getWorkflowInstanceEntries();
  }
});
