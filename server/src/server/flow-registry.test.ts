import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  type CompiledFlowDefinition,
  defineWorkflow,
} from "workflow-engine/workflow-types";
import {
  deleteUserDefinition,
  registerFlowDefinition,
  registerUserDefinition,
  resetFlowDefinitionsForTest,
  setDefinitionsBasePathForTest,
  updateUserDefinition,
} from "./flow-definitions.ts";
import { createFlowPersistence, type FlowStore } from "./flow-persistence.ts";
import type { FlowEventBusEvent } from "./flow-registry.ts";
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
} from "./flow-registry.ts";

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

// A workflow whose task declares a persist path — the engine refuses to
// construct its runtime without an absolute basePath.
const persistWorkflow = defineWorkflow({
  id: "persist-wf",
  label: "Persist Workflow",
  taskOutputs: {} as Record<string, never>,
  states: [
    {
      id: "active",
      label: "Active",
      category: "initial",
      tasks: [
        {
          id: "write_doc",
          label: "Write a doc",
          trigger: "auto",
          role: "operation",
          persist: { path: "doc.md" },
        },
      ],
    },
    { id: "done", label: "Done", category: "terminal" },
  ],
  initial: "active",
  terminalStates: ["done"],
});

const persistDefinition = {
  id: "persist-def",
  label: "Persist Definition",
  workflows: [persistWorkflow],
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
    // The hive-owned default workspace resolver reads the env var at call
    // time; pin it to the temp dir so the repair test never touches the real
    // hive data directory.
    process.env.HIVE_DATA_DIR = join(dir, "hive-data");
  });

  afterEach(() => {
    delete process.env.HIVE_DATA_DIR;
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

  it("createFlow does not seed a workflow whose initial state auto-runs an input-driven ai-task", () => {
    // A generated flow like ticket triage: the initial state's auto ai-task
    // declares inputFromInstanceState, and an empty seed would run the agent
    // with nothing to work on (a phantom ticket + a wasted model call). The
    // seed must be skipped; the user creates instances explicitly.
    const inputDriven = defineWorkflow({
      id: "tickets",
      label: "Tickets",
      taskOutputs: {} as Record<string, never>,
      states: [
        {
          id: "inbox",
          label: "Inbox",
          category: "initial",
          tasks: [
            {
              id: "triage",
              label: "Triage",
              trigger: "auto",
              role: "ai-task",
              systemPrompt: "Triage the ticket.",
              inputFromInstanceState: "description",
            },
          ],
        },
        { id: "triaged", label: "Triaged", category: "terminal" },
      ],
      initial: "inbox",
      terminalStates: ["triaged"],
    });
    const definition = {
      id: "tickets-def",
      label: "Tickets Def",
      workflows: [inputDriven],
      edges: [],
    } satisfies CompiledFlowDefinition;
    registerFlowDefinition(definition);

    const persistence = getFlowPersistence();
    assert.ok(persistence);
    createFlow("flow-tickets", "tickets-def", persistence);

    const persisted = persistence.loadFlow("flow-tickets");
    assert.ok(persisted);
    assert.equal(
      persisted.instances.length,
      0,
      "an input-driven initial ai-task must not be seeded empty"
    );
  });

  it("createFlow copies creation inputs into the seeded instance's declared state fields", () => {
    const charting = defineWorkflow({
      id: "charting",
      label: "Charting",
      taskOutputs: {} as Record<string, never>,
      instanceState: [
        { field: "destination", type: "string" },
        { field: "notes", type: "string" },
      ],
      states: [{ id: "naming", label: "Naming", category: "initial" }],
      initial: "naming",
      terminalStates: [],
    });
    const definition = {
      id: "charting-def",
      label: "Charting Def",
      workflows: [charting],
      edges: [],
    } satisfies CompiledFlowDefinition;
    registerFlowDefinition(definition);

    const persistence = getFlowPersistence();
    assert.ok(persistence);
    createFlow("flow-chart", "charting-def", persistence, {
      name: "flow-chart",
      destination: "A spec to hand off",
      notes: "Offline-first",
    });

    const persisted = persistence.loadFlow("flow-chart");
    assert.ok(persisted);
    assert.equal(persisted.instances.length, 1);
    assert.equal(
      persisted.instances[0].state.workflowInstanceState.destination,
      "A spec to hand off",
      "the creation destination seeds the first instance"
    );
    assert.equal(
      persisted.instances[0].state.workflowInstanceState.notes,
      "Offline-first"
    );
  });

  it("createFlow seeds an input-driven initial ai-task when its input is provided in the flow config", () => {
    const charting = defineWorkflow({
      id: "charting",
      label: "Charting",
      taskOutputs: {} as Record<string, never>,
      instanceState: [{ field: "destination", type: "string" }],
      states: [
        {
          id: "naming",
          label: "Naming",
          category: "initial",
          tasks: [
            {
              id: "nameSession",
              label: "Naming session",
              trigger: "auto",
              role: "ai-chat",
              startOnUserInput: true,
              systemPrompt: "Sharpen the destination.",
              inputFromInstanceState: "destination",
            },
          ],
        },
      ],
      initial: "naming",
      terminalStates: [],
    });
    const definition = {
      id: "charting-def",
      label: "Charting Def",
      workflows: [charting],
      edges: [],
    } satisfies CompiledFlowDefinition;
    registerFlowDefinition(definition);

    const persistence = getFlowPersistence();
    assert.ok(persistence);
    const runtime = createFlow("flow-chart", "charting-def", persistence, {
      name: "flow-chart",
      destination: "A spec to hand off",
    });

    assert.equal(runtime.workflowInstances.length, 1);
    const instance = runtime.workflowInstances[0];
    assert.equal(
      instance.workflowInstanceState.destination,
      "A spec to hand off"
    );
    // The inputful session is provided its input, so it starts immediately
    // (interactive — waiting for the human's first reply).
    assert.equal(
      instance.hasRunningTask,
      true,
      "the naming session starts on creation"
    );
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

  it("rehydrateFlow rejects a persist flow whose config has no basePath instead of repairing it", async () => {
    registerFlowDefinition(persistDefinition);
    const persistence = getFlowPersistence();
    assert.ok(persistence);
    // A persisted flow whose config lacks a basePath even though the
    // definition declares persist tasks is invalid: flow config is immutable
    // after creation, and creation always normalizes basePath. Rehydration
    // must reject it (no runtime) rather than silently rewriting the config.
    persistence.saveFlow("legacy-flow", { definitionId: "persist-def" }, {});
    const runtime = await rehydrateFlow(
      persistence,
      "legacy-flow",
      { definitionId: "persist-def" },
      {},
      []
    );
    assert.equal(runtime, null);
    // The persisted config is untouched — rejection never mutates it.
    const config = persistence.loadFlow("legacy-flow")?.config as
      | Record<string, unknown>
      | undefined;
    assert.equal(config?.basePath, undefined);
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

  it("rehydrateFlow resets a persisted instance whose state no longer exists to the workflow's initial state", async () => {
    const persistence = getFlowPersistence();
    assert.ok(persistence);
    createFlow("flow-a", "test-def", persistence);

    // Simulate definition drift: an instance persisted under an old state id
    // the current definition no longer declares (e.g. the authoring session's
    // retired drafting → finalizing → done lifecycle).
    persistence.saveInstance("flow-a", "legacy-instance", "test-wf", {
      currentState: "archived",
      taskOutputs: {},
      hasRunningTask: false,
      runningTaskId: null,
      runningTaskContext: null,
      workflowInstanceState: {},
      history: [],
      taskErrorCounts: {},
    });

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
    assert.equal(
      runtime.getWorkflowInstance("legacy-instance")?.getState().currentState,
      "idle"
    );
  });

  it("rehydrateFlow skips a persisted instance whose workflow no longer exists", async () => {
    const persistence = getFlowPersistence();
    assert.ok(persistence);
    createFlow("flow-a", "test-def", persistence);

    // Definition drift: an instance persisted under a workflow id the current
    // definition no longer declares (the workflow was removed entirely).
    persistence.saveInstance("flow-a", "removed-instance", "removed-wf", {
      currentState: "idle",
      taskOutputs: {},
      hasRunningTask: false,
      runningTaskId: null,
      runningTaskContext: null,
      workflowInstanceState: {},
      history: [],
      taskErrorCounts: {},
    });

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
    assert.equal(runtime.getWorkflowInstance("removed-instance"), undefined);
  });

  it("rehydrate uses the creation-time snapshot, not a later definition edit", async () => {
    const persistence = getFlowPersistence();
    assert.ok(persistence);
    const source = `
import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "snap-definition",
  label: "Snap Definition",
  configSchema: [],
  workflows: [
    {
      id: "wf",
      label: "Workflow",
      instanceState: [],
      initial: "idle",
      terminalStates: ["done"],
      states: [
        { id: "idle", label: "Original Label", category: "initial" },
        { id: "done", label: "Done", category: "terminal" },
      ],
    },
  ],
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
import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "gone-definition",
  label: "Gone Definition",
  configSchema: [],
  workflows: [
    {
      id: "wf",
      label: "Workflow",
      instanceState: [],
      initial: "idle",
      terminalStates: ["done"],
      states: [
        { id: "idle", label: "Kept Label", category: "initial" },
        { id: "done", label: "Done", category: "terminal" },
      ],
    },
  ],
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
      id: "add_issue",
      label: "Add issue",
      variant: "primary",
      createInstance: {
        workflowId: "item",
        fields: [
          { key: "title", label: "Title", type: "string", required: true },
          { key: "due", label: "Due", type: "date" },
          {
            key: "tags",
            label: "Tags",
            type: "string[]",
            options: ["bug", "feat"],
          },
          { key: "note", label: "Note", type: "textarea" },
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
} satisfies CompiledFlowDefinition;

describe("flow-level actions", () => {
  let dir: string;
  let definitionsDir: string;
  let persistence: FlowStore;

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
        { id: "add_issue", variant: "primary" },
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

  it("createInstance rejects an empty string for a required field", () => {
    createFlow("flow-a", "action-def", persistence);
    assert.throws(
      () => dispatchFlowLevelAction("flow-a", "add_item", { title: "" }),
      /cannot be empty/
    );
    assert.throws(
      () => dispatchFlowLevelAction("flow-a", "add_item", { title: "   " }),
      /cannot be empty/
    );
  });

  it("createInstance accepts and validates richer field types", () => {
    createFlow("flow-a", "action-def", persistence);
    const result = dispatchFlowLevelAction("flow-a", "add_issue", {
      title: "Fog on the dashboard",
      due: "2024-08-10",
      tags: ["bug", "feat"],
      note: "Saw it twice",
    });
    assert.equal(result.kind, "create_instance");
    const created = runtimeEntries("flow-a").find(
      (entry) => entry.id === result.instance.id
    );
    assert.ok(created);
    assert.deepEqual(created.state.workflowInstanceState, {
      title: "Fog on the dashboard",
      due: "2024-08-10",
      tags: ["bug", "feat"],
      note: "Saw it twice",
    });

    assert.throws(
      () =>
        dispatchFlowLevelAction("flow-a", "add_issue", {
          title: "X",
          due: "2024-13-40",
        }),
      /must be a date/
    );
    assert.throws(
      () =>
        dispatchFlowLevelAction("flow-a", "add_issue", {
          title: "X",
          tags: ["bogus"],
        }),
      /outside the allowed options/
    );
    assert.throws(
      () =>
        dispatchFlowLevelAction("flow-a", "add_issue", {
          title: "X",
          tags: "bug",
        }),
      /must be a string\[\]/
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
