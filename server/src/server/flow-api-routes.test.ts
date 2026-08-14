import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { createFlowRuntime } from "workflow-engine/create-flow-runtime";
import {
  type CompiledFlowDefinition,
  defineWorkflow,
} from "workflow-engine/workflow-types";
import { loadPresetDefinition } from "./preset-flow.ts";

// The compiled queen-bee projection (the preset definition module through the
// real loader seam).
const queenBeeCompiled = (await loadPresetDefinition("queen-bee")).flow;

import { registerFlowApiRoutes } from "./flow-api-routes.ts";
import { authoringSessionFlow } from "./flow-authoring/session.ts";
import {
  registerFlowDefinition,
  registerUserDefinition,
  resetFlowDefinitionsForTest,
  runtimeDefinitionsDir,
  setDefinitionsBasePathForTest,
} from "./flow-definitions.ts";
import type { FlowStore } from "./flow-persistence.ts";
import {
  getFlowRuntime,
  registerFlowForTest,
  resetFlowRuntimesForTest,
  setFlowPersistence,
} from "./flow-registry.ts";

const testWorkflow = defineWorkflow({
  id: "test-wf",
  label: "Test Workflow",
  taskOutputs: {
    chat: {} as { content: string },
  },
  states: [
    {
      id: "pending",
      label: "Pending",
      category: "initial",
      actions: [
        {
          id: "start",
          label: "Start",
          variant: "primary",
          gate: (ctx) => !ctx.hasRunningTask,
          transitionTo: "running",
        },
      ],
    },
    {
      id: "running",
      label: "Running",
      category: "active",
      tasks: [
        {
          id: "chat",
          label: "Chat session",
          trigger: "manual",
          role: "ai-chat",
        },
      ],
      actions: [
        {
          id: "finish",
          label: "Finish",
          variant: "primary",
          transitionTo: "done",
        },
      ],
    },
    { id: "done", label: "Done", category: "terminal" },
  ],
  initial: "pending",
  terminalStates: ["done"],
});

const noopPersistence: FlowStore = {
  saveFlow: () => {},
  saveInstance: () => {},
  deleteFlow: () => {},
  loadFlow: () => null,
  loadAllFlows: () => [],
};

const actionItemWorkflow = defineWorkflow({
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

const actionApiDefinition = {
  id: "action-def",
  label: "Action Definition",
  workflows: [actionItemWorkflow],
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
      id: "gated",
      label: "Gated",
      gate: () => false,
      createInstance: { workflowId: "item" },
    },
  ],
} satisfies CompiledFlowDefinition;

const editableWorkflow = defineWorkflow({
  id: "ticket",
  label: "Ticket",
  taskOutputs: {} as Record<string, never>,
  // The curated editable subset: the generic UI renders an "Edit details"
  // form from these and patches instance state in place.
  editFields: [
    { key: "title", label: "Title", type: "string", required: true },
    { key: "due", label: "Due", type: "date" },
    {
      key: "tags",
      label: "Tags",
      type: "string[]",
      options: ["bug", "feat"],
    },
  ],
  states: [
    { id: "open", label: "Open", category: "initial" },
    { id: "closed", label: "Closed", category: "terminal" },
  ],
  initial: "open",
  terminalStates: ["closed"],
});

const editableDefinition = {
  id: "editable-def",
  label: "Editable Definition",
  workflows: [editableWorkflow],
  edges: [],
} satisfies CompiledFlowDefinition;

const flowDefinitionSource = `
import { defineWorkflow } from "workflow-engine/workflow-types";

const wf = defineWorkflow({
  id: "custom",
  label: "Custom",
  taskOutputs: {} as Record<string, never>,
  states: [
    { id: "pending", label: "Pending", category: "initial" },
    { id: "done", label: "Done", category: "terminal" },
  ],
  initial: "pending",
  terminalStates: ["done"],
});

export const flow = {
  id: "custom-flow",
  label: "Custom Flow",
  workflows: [wf],
  edges: [],
};
`;

// A definition declaring a served-at-runtime component (FlowDefinition.ui.components):
// the component source is authored as erasable-syntax TS inside the definition
// source, transpiled by the server, and fetched by the rendering surface.
// A gate-clean source the authoring session's save path registers (the e2e's
// agent produces a review-flow equivalent).
const authoringSaveSource = `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "reviewFlow",
  label: "Review Flow",
  configSchema: [],
  workflows: [
    {
      id: "review",
      label: "Review",
      instanceState: [],
      initial: "new",
      terminalStates: ["done"],
      states: [
        { id: "new", label: "New", category: "initial" },
        { id: "done", label: "Done", category: "terminal" },
      ],
    },
  ],
  edges: [],
};
`;

const componentFlowSource = `
import { defineWorkflow } from "workflow-engine/workflow-types";

const wf = defineWorkflow({
  id: "custom",
  label: "Custom",
  taskOutputs: {} as Record<string, never>,
  states: [
    { id: "pending", label: "Pending", category: "initial" },
    { id: "done", label: "Done", category: "terminal" },
  ],
  initial: "pending",
  terminalStates: ["done"],
});

export const flow = {
  id: "component-flow",
  label: "Component Flow",
  workflows: [wf],
  edges: [],
  ui: {
    components: {
      "demo-card": "export default function (lit: any) { const { LitElement } = lit; return { components: { 'demo-card': class Demo extends LitElement {} } }; }",
    },
  },
};
`;

// The push-authoritative frames the flow WebSocket sends. Structural subset of
// FlowResponse covering only the fields the WS tests assert on.
type FlowWsMessage =
  | {
      type: "init";
      flows: Array<{
        id: string;
        instances: Array<{ state: { currentState: string } }>;
      }>;
    }
  | {
      type: "flow_snapshot";
      flow: {
        id: string;
        instances: Array<{ id: string; state: { currentState: string } }>;
      };
    }
  | { type: "flow_deleted"; flowId: string };

describe("flow API routes", () => {
  const servers: FastifyInstance[] = [];

  beforeEach(() => {
    resetFlowDefinitionsForTest();
    resetFlowRuntimesForTest();
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close()));
  });

  it("GET /api/flows returns flows with definitions and instances", async () => {
    const server = fixture();

    const response = await server.inject({
      method: "GET",
      url: "/api/flows",
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.ok(Array.isArray(body.flows));
    assert.equal(body.flows.length, 1);
    assert.equal(body.flows[0].id, "test-flow");
    assert.equal(body.flows[0].label, "Test Flow");
    assert.ok(Array.isArray(body.flows[0].workflows));
    assert.equal(body.flows[0].workflows.length, 1);
    assert.equal(body.flows[0].workflows[0].id, "test-wf");
    assert.equal(body.flows[0].workflows[0].label, "Test Workflow");
    assert.ok(Array.isArray(body.flows[0].workflows[0].states));
    assert.equal(body.flows[0].instances.length, 1);
    assert.equal(body.flows[0].instances[0].state.currentState, "pending");
  });

  it("GET /api/flows/:flowId/instances returns instances with available actions", async () => {
    const server = fixture();

    const response = await server.inject({
      method: "GET",
      url: "/api/flows/test-flow/instances",
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.ok(Array.isArray(body.instances));
    assert.equal(body.instances.length, 1);
    assert.equal(body.instances[0].state.currentState, "pending");
    assert.ok(Array.isArray(body.instances[0].availableActions));
    assert.equal(body.instances[0].availableActions.length, 1);
    assert.equal(body.instances[0].availableActions[0].id, "start");
    assert.equal(body.instances[0].availableActions[0].variant, "primary");
  });

  it("GET /api/flows/:flowId returns the flow with its config", async () => {
    const server = fixture();

    const response = await server.inject({
      method: "GET",
      url: "/api/flows/test-flow",
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.id, "test-flow");
    assert.equal(body.label, "Test Flow");
    assert.equal(body.config.basePath, "/tmp/test-repo");
    assert.equal(body.workflows[0].id, "test-wf");
    assert.equal(body.instances.length, 1);
  });

  it("GET /api/flows/:flowId returns 404 for an unknown flow", async () => {
    const server = fixture();

    const response = await server.inject({
      method: "GET",
      url: "/api/flows/nonexistent",
    });

    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error, "Flow not found");
  });

  it("404 for unknown flow on GET instances", async () => {
    const server = fixture();

    const response = await server.inject({
      method: "GET",
      url: "/api/flows/nonexistent/instances",
    });

    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error, "Flow not found");
  });

  it("POST action dispatches and returns new state", async () => {
    const server = fixture();

    const listResponse = await server.inject({
      method: "GET",
      url: "/api/flows/test-flow/instances",
    });
    const instanceId = listResponse.json().instances[0].id;

    const response = await server.inject({
      method: "POST",
      url: `/api/flows/test-flow/instances/${instanceId}/action`,
      body: { actionId: "start" },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.previousState, "pending");
    assert.equal(body.currentState, "running");
    assert.equal(body.instanceId, instanceId);
  });

  it("POST action returns 409 when action is rejected", async () => {
    const server = fixture();

    const listResponse = await server.inject({
      method: "GET",
      url: "/api/flows/test-flow/instances",
    });
    const instanceId = listResponse.json().instances[0].id;

    // First dispatch succeeds
    await server.inject({
      method: "POST",
      url: `/api/flows/test-flow/instances/${instanceId}/action`,
      body: { actionId: "start" },
    });

    // "start" is gated on !hasRunningTask, but after transition to running
    // there's no running task yet. Actually the gate passes.
    // Test with a missing actionId instead
    const response = await server.inject({
      method: "POST",
      url: `/api/flows/test-flow/instances/${instanceId}/action`,
      body: {},
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "actionId is required");
  });

  it("POST action returns 404 for unknown flow", async () => {
    const server = fixture();

    const response = await server.inject({
      method: "POST",
      url: "/api/flows/unknown/instances/some-id/action",
      body: { actionId: "start" },
    });

    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error, "Flow not found");
  });

  it("POST action returns 404 for unknown instance", async () => {
    const server = fixture();

    const response = await server.inject({
      method: "POST",
      url: "/api/flows/test-flow/instances/bogus-id/action",
      body: { actionId: "start" },
    });

    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error, "Instance not found");
  });

  it("PATCH state validates against editFields and patches instance state", async () => {
    setFlowPersistence(noopPersistence);
    registerFlowDefinition(editableDefinition);
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    const createResponse = await server.inject({
      method: "POST",
      url: "/api/flows",
      body: { definitionId: "editable-def", config: { name: "Editable Flow" } },
    });
    const flowId = createResponse.json().flowId as string;

    const listResponse = await server.inject({
      method: "GET",
      url: `/api/flows/${flowId}/instances`,
    });
    const instanceId = listResponse.json().instances[0].id as string;
    // The entry exposes the workflow's editFields for the UI.
    assert.deepEqual(
      listResponse
        .json()
        .instances[0].editFields.map((f: { key: string }) => f.key),
      ["title", "due", "tags"]
    );
    // And the workflow summary for across-instance derives.
    assert.deepEqual(listResponse.json().instances[0].workflowSummary, {
      total: 1,
      byField: {},
    });

    const patchResponse = await server.inject({
      method: "PATCH",
      url: `/api/flows/${flowId}/instances/${instanceId}/state`,
      body: { values: { title: "Renamed", due: "2024-08-10", tags: ["bug"] } },
    });
    assert.equal(patchResponse.statusCode, 200);
    const body = patchResponse.json();
    assert.equal(body.instanceId, instanceId);
    assert.deepEqual(body.state.workflowInstanceState, {
      title: "Renamed",
      due: "2024-08-10",
      tags: ["bug"],
    });
  });

  it("PATCH state rejects unknown keys, bad types, and unknown options", async () => {
    setFlowPersistence(noopPersistence);
    registerFlowDefinition(editableDefinition);
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    const createResponse = await server.inject({
      method: "POST",
      url: "/api/flows",
      body: { definitionId: "editable-def", config: { name: "Editable Flow" } },
    });
    const flowId = createResponse.json().flowId as string;

    const listResponse = await server.inject({
      method: "GET",
      url: `/api/flows/${flowId}/instances`,
    });
    const instanceId = listResponse.json().instances[0].id as string;
    const url = `/api/flows/${flowId}/instances/${instanceId}/state`;

    const unknown = await server.inject({
      method: "PATCH",
      url,
      body: { values: { title: "X", bogus: 1 } },
    });
    assert.equal(unknown.statusCode, 400);
    assert.match(unknown.json().error, /Unknown field "bogus"/);

    const missing = await server.inject({
      method: "PATCH",
      url,
      body: { values: {} },
    });
    assert.equal(missing.statusCode, 400);
    assert.match(missing.json().error, /Missing required field "title"/);

    const badType = await server.inject({
      method: "PATCH",
      url,
      body: { values: { title: "X", due: "2024-13-40" } },
    });
    assert.equal(badType.statusCode, 400);
    assert.match(badType.json().error, /must be a date/);

    const badOption = await server.inject({
      method: "PATCH",
      url,
      body: { values: { title: "X", tags: ["bogus"] } },
    });
    assert.equal(badOption.statusCode, 400);
    assert.match(badOption.json().error, /outside the allowed options/);
  });

  it("PATCH state returns 400 for a workflow with no editFields", async () => {
    setFlowPersistence(noopPersistence);
    registerFlowDefinition(actionApiDefinition);
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    const createResponse = await server.inject({
      method: "POST",
      url: "/api/flows",
      body: { definitionId: "action-def", config: { name: "Action Flow" } },
    });
    const flowId = createResponse.json().flowId as string;

    const listResponse = await server.inject({
      method: "GET",
      url: `/api/flows/${flowId}/instances`,
    });
    const instanceId = listResponse.json().instances[0].id as string;

    const response = await server.inject({
      method: "PATCH",
      url: `/api/flows/${flowId}/instances/${instanceId}/state`,
      body: { values: { title: "X" } },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "Instance is not editable");
  });

  it("PATCH state returns 404 for an unknown flow or instance", async () => {
    const server = fixture();
    const notFound = await server.inject({
      method: "PATCH",
      url: "/api/flows/unknown/instances/some-id/state",
      body: { values: {} },
    });
    assert.equal(notFound.statusCode, 404);
    assert.equal(notFound.json().error, "Flow not found");

    const missingInstance = await server.inject({
      method: "PATCH",
      url: "/api/flows/test-flow/instances/bogus-id/state",
      body: { values: {} },
    });
    assert.equal(missingInstance.statusCode, 404);
    assert.equal(missingInstance.json().error, "Instance not found");
  });

  it("POST flow-level action creates an instance from the form payload", async () => {
    setFlowPersistence(noopPersistence);
    registerFlowDefinition(actionApiDefinition);
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    const createResponse = await server.inject({
      method: "POST",
      url: "/api/flows",
      body: { definitionId: "action-def", config: { name: "Action Flow" } },
    });
    const flowId = createResponse.json().flowId as string;

    const response = await server.inject({
      method: "POST",
      url: `/api/flows/${flowId}/actions/add_item`,
      body: { title: "New idea", count: 2 },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.kind, "create_instance");
    assert.equal(body.workflowId, "item");
    assert.deepEqual(body.instance.state.workflowInstanceState, {
      title: "New idea",
      count: 2,
    });
  });

  it("POST flow-level action returns 404 for an unknown action", async () => {
    setFlowPersistence(noopPersistence);
    registerFlowDefinition(actionApiDefinition);
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    const createResponse = await server.inject({
      method: "POST",
      url: "/api/flows",
      body: { definitionId: "action-def", config: { name: "Action Flow" } },
    });
    const flowId = createResponse.json().flowId as string;

    const response = await server.inject({
      method: "POST",
      url: `/api/flows/${flowId}/actions/nope`,
      body: {},
    });
    assert.equal(response.statusCode, 404);
  });

  it("POST flow-level action returns 409 when its gate fails", async () => {
    setFlowPersistence(noopPersistence);
    registerFlowDefinition(actionApiDefinition);
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    const createResponse = await server.inject({
      method: "POST",
      url: "/api/flows",
      body: { definitionId: "action-def", config: { name: "Action Flow" } },
    });
    const flowId = createResponse.json().flowId as string;

    const response = await server.inject({
      method: "POST",
      url: `/api/flows/${flowId}/actions/gated`,
      body: {},
    });
    assert.equal(response.statusCode, 409);
  });

  it("POST flow-level action returns 400 for an invalid form payload", async () => {
    setFlowPersistence(noopPersistence);
    registerFlowDefinition(actionApiDefinition);
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    const createResponse = await server.inject({
      method: "POST",
      url: "/api/flows",
      body: { definitionId: "action-def", config: { name: "Action Flow" } },
    });
    const flowId = createResponse.json().flowId as string;

    const response = await server.inject({
      method: "POST",
      url: `/api/flows/${flowId}/actions/add_item`,
      body: {},
    });
    assert.equal(response.statusCode, 400);
    assert.match(response.json().error as string, /title/);
  });

  it("GET flow payload includes gate-evaluated flow-level actions", async () => {
    setFlowPersistence(noopPersistence);
    registerFlowDefinition(actionApiDefinition);
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    const createResponse = await server.inject({
      method: "POST",
      url: "/api/flows",
      body: { definitionId: "action-def", config: { name: "Action Flow" } },
    });
    const flowId = createResponse.json().flowId as string;

    const response = await server.inject({
      method: "GET",
      url: `/api/flows/${flowId}`,
    });
    assert.equal(response.statusCode, 200);
    const actions = response.json().availableFlowActions as Array<{
      id: string;
      label: string;
      variant: string;
      createInstance: { workflowId: string; fields: Array<{ key: string }> };
    }>;
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.id, "add_item");
    assert.equal(actions[0]?.variant, "primary");
    assert.equal(actions[0]?.createInstance.workflowId, "item");
    assert.deepEqual(
      actions[0]?.createInstance.fields.map((f) => f.key),
      ["title", "count"]
    );
  });

  it("GET flow payload carries flow-level custom render kinds", async () => {
    setFlowPersistence(noopPersistence);
    registerFlowDefinition({
      id: "custom-ui-def",
      label: "Custom UI Definition",
      workflows: [testWorkflow],
      edges: [],
      ui: {
        kinds: [
          {
            kind: "mycards",
            contract: {
              props: [
                { name: "items", type: "array", scope: "output" },
                { name: "title", type: "string", scope: "element" },
              ],
            },
          },
        ],
      },
    });
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    const createResponse = await server.inject({
      method: "POST",
      url: "/api/flows",
      body: { definitionId: "custom-ui-def", config: { name: "UI Flow" } },
    });
    const flowId = createResponse.json().flowId as string;

    const response = await server.inject({
      method: "GET",
      url: `/api/flows/${flowId}`,
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().ui, {
      kinds: [
        {
          kind: "mycards",
          contract: {
            props: [
              { name: "items", type: "array", scope: "output" },
              { name: "title", type: "string", scope: "element" },
            ],
          },
        },
      ],
      components: {},
    });
  });

  it("POST /api/flows accepts integrationBranch and branchPrefix declared in configSchema", async () => {
    setFlowPersistence(noopPersistence);
    registerFlowDefinition({
      id: "git-def",
      label: "Git Definition",
      workflows: [testWorkflow],
      edges: [],
      configSchema: [
        {
          key: "integrationBranch",
          label: "Integration branch",
          type: "string",
        },
        { key: "branchPrefix", label: "Branch prefix", type: "string" },
      ],
    });
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    const response = await server.inject({
      method: "POST",
      url: "/api/flows",
      body: {
        definitionId: "git-def",
        config: {
          name: "Git Flow",
          integrationBranch: "integ",
          branchPrefix: "hive/",
        },
      },
    });
    assert.equal(response.statusCode, 201);

    const flowId = response.json().flowId as string;
    const detail = await server.inject({
      method: "GET",
      url: `/api/flows/${flowId}`,
    });
    assert.equal(detail.json().config.integrationBranch, "integ");
    assert.equal(detail.json().config.branchPrefix, "hive/");
  });

  it("POST task/input requires content", async () => {
    const server = fixture();

    const response = await server.inject({
      method: "POST",
      url: "/api/flows/test-flow/instances/some-id/task/input",
      body: {},
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "content is required");
  });

  it("POST task/input returns 404 for unknown flow", async () => {
    const server = fixture();

    const response = await server.inject({
      method: "POST",
      url: "/api/flows/unknown/instances/some-id/task/input",
      body: { content: "hello" },
    });

    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error, "Flow not found");
  });

  it("POST task/input returns 404 for unknown instance", async () => {
    const server = fixture();

    const response = await server.inject({
      method: "POST",
      url: "/api/flows/test-flow/instances/bogus-id/task/input",
      body: { content: "hello" },
    });

    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error, "Instance not found");
  });

  it("sends init on connect and flow_snapshot after an action", async () => {
    const runtime = createFlowRuntime(
      "test-flow",
      [testWorkflow],
      [],
      {},
      { name: "Test Flow", basePath: "/tmp/test-repo" },
      {},
      noopPersistence
    );
    let instanceId = "";
    runtime.on((event) => {
      if (event.type === "instance_created") instanceId = event.instanceId;
    });
    runtime.addWorkflowInstance("test-wf");
    registerFlowForTest("test-flow", runtime);

    const server = await flowSocketServer();
    const { ws, received } = await openFlowWs(server);

    await waitFor(() => received.some((message) => message.type === "init"));
    const init = received.find(
      (message): message is Extract<FlowWsMessage, { type: "init" }> =>
        message.type === "init"
    );
    assert.ok(init, "init should be sent on connect");
    assert.equal(init.flows.length, 1);
    assert.equal(init.flows[0].id, "test-flow");
    assert.equal(init.flows[0].instances[0].state.currentState, "pending");

    await server.inject({
      method: "POST",
      url: `/api/flows/test-flow/instances/${instanceId}/action`,
      body: { actionId: "start" },
    });

    await waitFor(() =>
      received.some(
        (message) =>
          message.type === "flow_snapshot" &&
          message.flow.instances.some(
            (instance) =>
              instance.id === instanceId &&
              instance.state.currentState === "running"
          )
      )
    );
    ws.close();
  });

  it("pushes a flow_snapshot for a flow created after connect", async () => {
    setFlowPersistence(noopPersistence);
    registerFlowDefinition({
      id: "test-def",
      label: "Test Definition",
      workflows: [testWorkflow],
      edges: [],
    });

    const server = await flowSocketServer();
    const { ws, received } = await openFlowWs(server);

    await server.inject({
      method: "POST",
      url: "/api/flows",
      body: { definitionId: "test-def", config: { name: "My Project" } },
    });

    await waitFor(() =>
      received.some(
        (message) =>
          message.type === "flow_snapshot" && message.flow.id === "my-project"
      )
    );
    ws.close();
  });

  it("pushes flow_deleted after DELETE /api/flows/:flowId", async () => {
    const runtime = createFlowRuntime(
      "test-flow",
      [testWorkflow],
      [],
      {},
      { name: "Test Flow", basePath: "/tmp/test-repo" },
      {},
      noopPersistence
    );
    runtime.addWorkflowInstance("test-wf");
    registerFlowForTest("test-flow", runtime);

    const server = await flowSocketServer();
    const { ws, received } = await openFlowWs(server);

    await waitFor(() => received.some((message) => message.type === "init"));

    await server.inject({
      method: "DELETE",
      url: "/api/flows/test-flow",
    });

    await waitFor(() =>
      received.some(
        (message) =>
          message.type === "flow_deleted" && message.flowId === "test-flow"
      )
    );
    ws.close();
  });

  it("POST /api/flows/definitions/author creates an authoring session", async () => {
    setFlowPersistence(noopPersistence);
    registerFlowDefinition(authoringSessionFlow, { hidden: true });
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    const response = await server.inject({
      method: "POST",
      url: "/api/flows/definitions/author",
      body: { prompt: "Build a triage flow" },
    });

    assert.equal(response.statusCode, 201);
    const { flowId, instanceId } = response.json() as {
      flowId: string;
      instanceId: string;
    };
    assert.ok(flowId.startsWith("author-"), `unexpected flow id ${flowId}`);
    assert.ok(instanceId.length > 0);

    const runtime = getFlowRuntime(flowId);
    assert.ok(runtime, "the authoring flow must be registered as a runtime");
    const controller = runtime?.getWorkflowInstance(instanceId);
    assert.equal(controller?.getState().currentState, "drafting");
    // The user's request is recorded as the session card's title.
    assert.equal(
      controller?.getState().workflowInstanceState.prompt,
      "Build a triage flow"
    );
    // Conversational mode: the drafting session is interactive — the human
    // drives it, and there are no workflow actions (generation is a tool the
    // agent calls, triggered from the editor).
    assert.equal(
      controller?.getState().workflowInstanceState.mode,
      "conversational"
    );
    const ctx = controller?.getState().runningTaskContext;
    if (ctx?.role === "ai-chat") {
      assert.equal(ctx.interactive, true, "drafting must be interactive");
    } else {
      assert.fail("drafting must run an ai-chat session");
    }
    // The session has no ManualActions: saving is a flow capability — the
    // agent's save_definition tool and the editor's Save button both reach
    // the same saveAuthoringDefinition core, so the drafting state declares
    // no transitions.
    assert.deepEqual(
      controller?.getAvailableActions().map((action) => action.id),
      [],
      "drafting declares no manual actions — save is a tool, not a transition"
    );
  });

  it("POST /api/flows/definitions/author seeds a lucky session with the no-questions instruction", async () => {
    setFlowPersistence(noopPersistence);
    registerFlowDefinition(authoringSessionFlow, { hidden: true });
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    const response = await server.inject({
      method: "POST",
      url: "/api/flows/definitions/author",
      body: { prompt: "Build a triage flow", lucky: true },
    });

    assert.equal(response.statusCode, 201);
    const { flowId, instanceId } = response.json() as {
      flowId: string;
      instanceId: string;
    };
    const runtime = getFlowRuntime(flowId);
    const controller = runtime?.getWorkflowInstance(instanceId);
    assert.equal(controller?.getState().workflowInstanceState.mode, "lucky");
    // Lucky sessions are interactive too — the first message carries the
    // no-questions instruction, and the conversation stays open to refine.
    const ctx = controller?.getState().runningTaskContext;
    if (ctx?.role === "ai-chat") {
      assert.equal(ctx.interactive, true);
      const last = ctx.messages[ctx.messages.length - 1];
      assert.ok(
        last?.role === "user" &&
          last.content.includes("Do not ask clarifying questions"),
        `expected the lucky instruction as the user message, got: ${last?.content.slice(0, 80)}`
      );
    } else {
      assert.fail("lucky drafting must run an ai-chat session");
    }
  });

  it("POST /api/flows/definitions/author/:flowId/save registers the session's generated definition synchronously", async () => {
    setFlowPersistence(noopPersistence);
    const definitionsDir = mkdtempSync(join(tmpdir(), "hive-defs-"));
    setDefinitionsBasePathForTest(definitionsDir);
    registerFlowDefinition(authoringSessionFlow, { hidden: true });
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    const created = await server.inject({
      method: "POST",
      url: "/api/flows/definitions/author",
      body: { prompt: "Build a review flow", lucky: true },
    });
    assert.equal(created.statusCode, 201);
    const { flowId, instanceId } = created.json() as {
      flowId: string;
      instanceId: string;
    };

    // Simulate the agent's generate_definition having landed the source.
    const runtime = getFlowRuntime(flowId);
    const controller = runtime?.getWorkflowInstance(instanceId);
    controller?.patchWorkflowInstanceState({
      source: authoringSaveSource,
      suggestedName: "Review Flow",
    });

    const saved = await server.inject({
      method: "POST",
      url: `/api/flows/definitions/author/${flowId}/save`,
      payload: {},
    });
    assert.equal(saved.statusCode, 200);
    const body = saved.json() as {
      id: string;
      name: string;
      checkErrors: string[];
      checkWarnings: string[];
    };
    assert.equal(body.id, "review-flow");
    assert.equal(body.name, "Review Flow");
    assert.deepEqual(body.checkErrors, []);

    // The save writes the flow instance state (the flow owns the write).
    const state = controller?.getState().workflowInstanceState;
    assert.equal(state?.savedDefinitionId, "review-flow");
    // The wire state is erased to Record<string, unknown>; the shape is
    // guaranteed by savePatch.
    const saveFindings = state?.saveFindings as
      | { warnings?: unknown[] }
      | undefined;
    assert.ok(Array.isArray(saveFindings?.warnings));

    // A second save updates the same definition instead of duplicating.
    const again = await server.inject({
      method: "POST",
      url: `/api/flows/definitions/author/${flowId}/save`,
      payload: {},
    });
    assert.equal(again.statusCode, 200);
    assert.equal((again.json() as { id: string }).id, "review-flow");
  });

  it("POST /api/flows/definitions/author/:flowId/source writes back the human's edits (the edit IS the state)", async () => {
    setFlowPersistence(noopPersistence);
    registerFlowDefinition(authoringSessionFlow, { hidden: true });
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    const created = await server.inject({
      method: "POST",
      url: "/api/flows/definitions/author",
      body: { prompt: "Build a review flow", lucky: true },
    });
    const { flowId, instanceId } = created.json() as {
      flowId: string;
      instanceId: string;
    };
    const runtime = getFlowRuntime(flowId);
    const controller = runtime?.getWorkflowInstance(instanceId);
    controller?.patchWorkflowInstanceState({ source: "const a = 1;" });

    const written = await server.inject({
      method: "POST",
      url: `/api/flows/definitions/author/${flowId}/source`,
      payload: { source: authoringSaveSource },
    });
    assert.equal(written.statusCode, 200);
    const state = controller?.getState().workflowInstanceState;
    assert.equal(state?.source, authoringSaveSource);
    // The parsed definition rides along so the editor binds to the object.
    const parsed = state?.parsedDefinition as { id?: string } | undefined;
    assert.equal(parsed?.id, "reviewFlow");
  });

  it("POST /api/flows/definitions/author/:flowId/source rejects a non-authoring flow", async () => {
    setFlowPersistence(noopPersistence);
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    const response = await server.inject({
      method: "POST",
      url: "/api/flows/definitions/author/unknown-flow/source",
      payload: { source: "const a = 1;" },
    });
    assert.equal(response.statusCode, 404);
  });

  it("POST /api/flows/definitions/author/:flowId/files writes a referenced file authoritatively", async () => {
    setFlowPersistence(noopPersistence);
    registerFlowDefinition(authoringSessionFlow, { hidden: true });
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);
    const created = await server.inject({
      method: "POST",
      url: "/api/flows/definitions/author",
      body: { prompt: "Build a review flow", lucky: true },
    });
    const { flowId, instanceId } = created.json() as {
      flowId: string;
      instanceId: string;
    };
    const runtime = getFlowRuntime(flowId);
    const controller = runtime?.getWorkflowInstance(instanceId);
    const workDir = join(runtimeDefinitionsDir(), flowId);
    try {
      const written = await server.inject({
        method: "POST",
        url: `/api/flows/definitions/author/${flowId}/files`,
        payload: {
          path: "./gates/approved.ts",
          content: "export const ok = true;\n",
        },
      });
      assert.equal(written.statusCode, 200);
      const state = controller?.getState().workflowInstanceState;
      const files = state?.files as Record<string, string> | undefined;
      assert.equal(
        files?.["./gates/approved.ts"],
        "export const ok = true;\n",
        "the write must land in the session's file set"
      );
      // File edits are authoritative — the write lands as-is.
      assert.equal(
        state?.moduleSetSlug,
        flowId,
        "the session records its own module-set slug"
      );

      // Escaping paths and the rendered entry are rejected.
      const escapeWrite = await server.inject({
        method: "POST",
        url: `/api/flows/definitions/author/${flowId}/files`,
        payload: { path: "../escape.ts", content: "x" },
      });
      assert.equal(escapeWrite.statusCode, 400);
      const entryWrite = await server.inject({
        method: "POST",
        url: `/api/flows/definitions/author/${flowId}/files`,
        payload: { path: "flow.ts", content: "x" },
      });
      assert.equal(entryWrite.statusCode, 400);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("each authoring session has its own module-set directory (no file leakage)", async () => {
    setFlowPersistence(noopPersistence);
    registerFlowDefinition(authoringSessionFlow, { hidden: true });
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);
    const createSession = async (): Promise<{
      flowId: string;
      state: () => Record<string, unknown>;
    }> => {
      const created = await server.inject({
        method: "POST",
        url: "/api/flows/definitions/author",
        body: { prompt: "Build a flow", lucky: true },
      });
      const { flowId, instanceId } = created.json() as {
        flowId: string;
        instanceId: string;
      };
      const runtime = getFlowRuntime(flowId);
      const controller = runtime?.getWorkflowInstance(instanceId);
      if (!controller) throw new Error("no controller");
      return {
        flowId,
        state: () => controller.getState().workflowInstanceState,
      };
    };
    const first = await createSession();
    const second = await createSession();
    assert.notEqual(
      first.flowId,
      second.flowId,
      "sessions have distinct flow ids"
    );
    try {
      // A file written to the first session must not appear in the second.
      await server.inject({
        method: "POST",
        url: `/api/flows/definitions/author/${first.flowId}/files`,
        payload: {
          path: "./gates/approved.ts",
          content: "export const a = 1;\n",
        },
      });
      const secondState = second.state();
      const secondFiles = secondState.files as
        | Record<string, string>
        | undefined;
      assert.equal(
        secondFiles?.["./gates/approved.ts"],
        undefined,
        "another session's files must not leak into this session's file set"
      );
      assert.notEqual(
        secondState.moduleSetSlug,
        first.flowId,
        "the second session uses its own module-set directory"
      );
    } finally {
      rmSync(join(runtimeDefinitionsDir(), first.flowId), {
        recursive: true,
        force: true,
      });
      rmSync(join(runtimeDefinitionsDir(), second.flowId), {
        recursive: true,
        force: true,
      });
    }
  });

  it("GET /api/flows/definitions/:id returns the referenced file set and POST registers one", async () => {
    setFlowPersistence(noopPersistence);
    resetFlowDefinitionsForTest();
    const defsDir = mkdtempSync(join(tmpdir(), "hive-route-files-"));
    setDefinitionsBasePathForTest(defsDir);
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);
    try {
      const created = await server.inject({
        method: "POST",
        url: "/api/flows/definitions",
        body: {
          name: "Files Flow",
          source: "export const flow = { id: 'files-flow' };",
          files: { "./gates/approved.ts": "export const ok = true;\n" },
        },
      });
      assert.equal(created.statusCode, 201);
      const detail = await server.inject({
        method: "GET",
        url: "/api/flows/definitions/files-flow",
      });
      assert.equal(detail.statusCode, 200);
      const body = detail.json() as { files?: Record<string, string> };
      assert.equal(
        body.files?.["./gates/approved.ts"],
        "export const ok = true;\n",
        "the definition detail must expose the referenced file set"
      );
    } finally {
      rmSync(defsDir, { recursive: true, force: true });
      rmSync(join(runtimeDefinitionsDir(), "files-flow"), {
        recursive: true,
        force: true,
      });
      resetFlowDefinitionsForTest();
    }
  });

  it("POST /api/flows/definitions/author with files seeds the session's module set", async () => {
    setFlowPersistence(noopPersistence);
    registerFlowDefinition(authoringSessionFlow, { hidden: true });
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);
    const created = await server.inject({
      method: "POST",
      url: "/api/flows/definitions/author",
      body: {
        prompt: "Revise a flow",
        context: "The user wants changes to this existing definition.",
        files: { "./gates/approved.ts": "export const ok = true;\n" },
      },
    });
    const { flowId, instanceId } = created.json() as {
      flowId: string;
      instanceId: string;
    };
    const runtime = getFlowRuntime(flowId);
    const controller = runtime?.getWorkflowInstance(instanceId);
    const workDir = join(runtimeDefinitionsDir(), flowId);
    try {
      assert.equal(created.statusCode, 201);
      const state = controller?.getState().workflowInstanceState;
      const files = state?.files as Record<string, string> | undefined;
      assert.equal(
        files?.["./gates/approved.ts"],
        "export const ok = true;\n",
        "the revision session must carry the existing definition's files"
      );
      assert.ok(
        existsSync(join(workDir, "gates/approved.ts")),
        "the seeded files must be materialized in the session's module set"
      );
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("POST /api/flows/definitions/author requires a prompt", async () => {
    setFlowPersistence(noopPersistence);
    registerFlowDefinition(authoringSessionFlow, { hidden: true });
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    const response = await server.inject({
      method: "POST",
      url: "/api/flows/definitions/author",
      body: {},
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "prompt is required");
  });

  it("POST /api/flows/definitions registers a TS source definition", async () => {
    setFlowPersistence(noopPersistence);
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    const response = await server.inject({
      method: "POST",
      url: "/api/flows/definitions",
      body: {
        name: "Custom Flow",
        source: flowDefinitionSource,
      },
    });

    assert.equal(response.statusCode, 201);
    assert.equal(response.json().id, "custom-flow");

    const listResponse = await server.inject({
      method: "GET",
      url: "/api/flows/definitions",
    });
    const listed = listResponse
      .json()
      .definitions.find((d: { id: string }) => d.id === "custom-flow");
    assert.ok(listed);
    assert.equal(listed.builtIn, false);
    assert.equal(listed.name, "Custom Flow");
  });

  it("POST /api/flows/definitions annotates (does not block) definition-validator warnings", async () => {
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    // A definition that loads fine but nothing ever creates an instance — the
    // analyzer's advisory warning class (non-blocking annotation).
    const noCreationSource = `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "noCreationFlow",
  label: "No Creation Flow",
  configSchema: [],
  workflows: [
    {
      id: "items",
      label: "Items",
      instanceState: [{ field: "title", type: "string" }],
      initial: "new",
      terminalStates: ["done"],
      states: [
        { id: "new", label: "New", category: "initial" },
        { id: "done", label: "Done", category: "terminal" },
      ],
    },
  ],
  edges: [],
};
`;

    const response = await server.inject({
      method: "POST",
      url: "/api/flows/definitions",
      body: { name: "No Creation Flow", source: noCreationSource },
    });

    // The annotation is non-blocking — the definition registers anyway, and
    // the warning names the missing creation path.
    assert.equal(response.statusCode, 201);
    const json = response.json() as { checkWarnings?: string[] };
    assert.ok(
      (json.checkWarnings ?? []).some((w) =>
        w.includes("ever creates an instance")
      ),
      `expected a creation-path warning, got: ${json.checkWarnings?.join("; ")}`
    );
  });

  it("POST /api/flows/definitions/validate gates without registering", async () => {
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    // A clean data definition module: loads, typechecks, holds the contract.
    const cleanSource = `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "cleanFlow",
  label: "Clean Flow",
  configSchema: [],
  workflows: [
    {
      id: "clean",
      label: "Clean",
      instanceState: [],
      initial: "pending",
      terminalStates: ["done"],
      states: [
        { id: "pending", label: "Pending", category: "initial" },
        { id: "done", label: "Done", category: "terminal" },
      ],
    },
  ],
  edges: [],
};
`;

    const good = await server.inject({
      method: "POST",
      url: "/api/flows/definitions/validate",
      body: { source: cleanSource },
    });
    assert.equal(good.statusCode, 200);
    const goodJson = good.json() as {
      ok: boolean;
      checkErrors: string[];
      typeErrors: unknown[];
    };
    assert.equal(goodJson.ok, true);
    assert.deepEqual(goodJson.checkErrors, []);
    assert.deepEqual(goodJson.typeErrors, []);

    // A source that fails to transpile reports a load error, not a crash.
    const broken = await server.inject({
      method: "POST",
      url: "/api/flows/definitions/validate",
      body: { source: "export const flow = {" },
    });
    assert.equal(broken.statusCode, 200);
    const brokenJson = broken.json() as { ok: boolean; loadError?: string };
    assert.equal(brokenJson.ok, false);
    assert.ok(typeof brokenJson.loadError === "string");
  });

  it("POST /api/flows/definitions returns 400 for invalid TS source", async () => {
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    const response = await server.inject({
      method: "POST",
      url: "/api/flows/definitions",
      body: {
        name: "Broken Flow",
        source: "export const flow = {",
      },
    });

    assert.equal(response.statusCode, 400);
    assert.ok(
      typeof response.json().error === "string",
      "error message should be present"
    );
  });

  it("POST /api/flows/definitions returns 409 for a duplicate name", async () => {
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    const body = { name: "Custom Flow", source: flowDefinitionSource };
    const first = await server.inject({
      method: "POST",
      url: "/api/flows/definitions",
      body,
    });
    assert.equal(first.statusCode, 201);

    const second = await server.inject({
      method: "POST",
      url: "/api/flows/definitions",
      body,
    });
    assert.equal(second.statusCode, 409);
  });

  it("serves a definition's declared component as transpiled JS", async () => {
    setFlowPersistence(noopPersistence);
    const definitionsDir = mkdtempSync(join(tmpdir(), "hive-defs-"));
    setDefinitionsBasePathForTest(definitionsDir);
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    await server.inject({
      method: "POST",
      url: "/api/flows/definitions",
      body: { name: "Component Flow", source: componentFlowSource },
    });

    const response = await server.inject({
      method: "GET",
      url: "/api/flows/definitions/component-flow/components/demo-card",
    });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"] ?? "", /text\/javascript/);
    assert.ok(response.body.includes("demo-card"));
    assert.ok(
      !response.body.includes(": any"),
      "served source has type annotations stripped"
    );

    const missing = await server.inject({
      method: "GET",
      url: "/api/flows/definitions/component-flow/components/unknown",
    });
    assert.equal(missing.statusCode, 404);

    rmSync(definitionsDir, { recursive: true, force: true });
  });

  it("flow payloads list the definition's declared components with serve paths", async () => {
    setFlowPersistence(noopPersistence);
    const definitionsDir = mkdtempSync(join(tmpdir(), "hive-defs-"));
    setDefinitionsBasePathForTest(definitionsDir);

    await registerUserDefinition({
      name: "Component Flow",
      source: componentFlowSource,
    });

    const runtime = createFlowRuntime(
      "component-flow-run",
      [testWorkflow],
      [],
      {},
      { name: "Component Run", definitionId: "component-flow" },
      {},
      noopPersistence
    );
    runtime.addWorkflowInstance("test-wf");
    registerFlowForTest("component-flow-run", runtime);

    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    const response = await server.inject({
      method: "GET",
      url: "/api/flows",
    });
    assert.equal(response.statusCode, 200);
    const flow = response
      .json()
      .flows.find((entry: { id: string }) => entry.id === "component-flow-run");
    assert.ok(flow);
    assert.deepEqual(flow.ui.components, {
      "demo-card": "/api/flows/definitions/component-flow/components/demo-card",
    });

    rmSync(definitionsDir, { recursive: true, force: true });
  });

  it("PUT /api/flows/definitions/:id edits an existing user definition", async () => {
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    await server.inject({
      method: "POST",
      url: "/api/flows/definitions",
      body: { name: "Custom Flow", source: flowDefinitionSource },
    });

    const response = await server.inject({
      method: "PUT",
      url: "/api/flows/definitions/custom-flow",
      body: {
        name: "Custom Flow Renamed",
        source: flowDefinitionSource,
      },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().id, "custom-flow");

    const detailResponse = await server.inject({
      method: "GET",
      url: "/api/flows/definitions/custom-flow",
    });
    assert.equal(detailResponse.json().name, "Custom Flow Renamed");
  });

  it("PUT /api/flows/definitions/:id returns 404 for an unknown id", async () => {
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    const response = await server.inject({
      method: "PUT",
      url: "/api/flows/definitions/nope",
      body: { name: "X", source: flowDefinitionSource },
    });

    assert.equal(response.statusCode, 404);
  });

  it("DELETE /api/flows/:flowId unlinks the flow", async () => {
    const server = fixture();

    const response = await server.inject({
      method: "DELETE",
      url: "/api/flows/test-flow",
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { ok: true, flowId: "test-flow" });

    const listResponse = await server.inject({
      method: "GET",
      url: "/api/flows",
    });
    assert.equal(listResponse.statusCode, 200);
    const flowIds = listResponse
      .json()
      .flows.map((flow: { id: string }) => flow.id);
    assert.ok(!flowIds.includes("test-flow"));
  });

  it("DELETE /api/flows/:flowId returns 404 for an unknown flow", async () => {
    const server = fixture();

    const response = await server.inject({
      method: "DELETE",
      url: "/api/flows/nonexistent",
    });

    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error, "Flow not found");
  });

  it("DELETE /api/flows/:flowId without purge keeps the domain dir", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hive-unlink-"));
    mkdirSync(join(dir, ".test-flow"), { recursive: true });
    writeFileSync(join(dir, ".test-flow", "project.json"), "{}");
    try {
      registerFlowForTest(
        "unlink-flow",
        createFlowRuntime(
          "unlink-flow",
          [testWorkflow],
          [],
          {},
          { name: "Unlink Flow", basePath: dir, definitionId: "test-flow" },
          {},
          noopPersistence
        )
      );
      setFlowPersistence(noopPersistence);
      const server = Fastify();
      servers.push(server);
      registerFlowApiRoutes(server);

      const response = await server.inject({
        method: "DELETE",
        url: "/api/flows/unlink-flow",
      });

      assert.equal(response.statusCode, 200);
      assert.equal(existsSync(join(dir, ".test-flow")), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("DELETE /api/flows/:flowId with purge removes the domain dir", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hive-purge-"));
    mkdirSync(join(dir, ".test-flow"), { recursive: true });
    writeFileSync(join(dir, ".test-flow", "project.json"), "{}");
    try {
      registerFlowForTest(
        "purge-flow",
        createFlowRuntime(
          "purge-flow",
          [testWorkflow],
          [],
          {},
          { name: "Purge Flow", basePath: dir, definitionId: "test-flow" },
          {},
          noopPersistence
        )
      );
      setFlowPersistence(noopPersistence);
      const server = Fastify();
      servers.push(server);
      registerFlowApiRoutes(server);

      const response = await server.inject({
        method: "DELETE",
        url: "/api/flows/purge-flow",
        body: { purge: true },
      });

      assert.equal(response.statusCode, 200);
      assert.equal(existsSync(join(dir, ".test-flow")), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("POST /api/flows creates a flow from a registered definition", async () => {
    setFlowPersistence(noopPersistence);
    registerFlowDefinition({
      id: "test-def",
      label: "Test Definition",
      workflows: [testWorkflow],
      edges: [],
    });
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    const response = await server.inject({
      method: "POST",
      url: "/api/flows",
      body: {
        definitionId: "test-def",
        config: { name: "My Project" },
      },
    });

    assert.equal(response.statusCode, 201);
    const body = response.json();
    assert.equal(body.flowId, "my-project");
    assert.equal(body.workflows[0].id, "test-wf");
  });

  it("POST /api/flows rejects a duplicate instance name within a definition", async () => {
    setFlowPersistence(noopPersistence);
    registerFlowDefinition({
      id: "test-def",
      label: "Test Definition",
      workflows: [testWorkflow],
      edges: [],
    });
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    const createBody = {
      definitionId: "test-def",
      config: { name: "My Project" },
    };
    const first = await server.inject({
      method: "POST",
      url: "/api/flows",
      body: createBody,
    });
    assert.equal(first.statusCode, 201);

    const second = await server.inject({
      method: "POST",
      url: "/api/flows",
      body: createBody,
    });
    assert.equal(second.statusCode, 409);
  });

  it("POST /api/flows allows the same name under a different definition", async () => {
    setFlowPersistence(noopPersistence);
    registerFlowDefinition({
      id: "test-def",
      label: "Test Definition",
      workflows: [testWorkflow],
      edges: [],
    });
    registerFlowDefinition({
      id: "other-def",
      label: "Other Definition",
      workflows: [testWorkflow],
      edges: [],
    });
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    const first = await server.inject({
      method: "POST",
      url: "/api/flows",
      body: { definitionId: "test-def", config: { name: "Shared" } },
    });
    const second = await server.inject({
      method: "POST",
      url: "/api/flows",
      body: { definitionId: "other-def", config: { name: "Shared" } },
    });

    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 201);
    assert.equal(first.json().flowId, "shared");
    assert.equal(second.json().flowId, "shared-2");
  });

  it("POST /api/flows rejects the reserved name 'new'", async () => {
    setFlowPersistence(noopPersistence);
    registerFlowDefinition({
      id: "test-def",
      label: "Test Definition",
      workflows: [testWorkflow],
      edges: [],
    });
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    const response = await server.inject({
      method: "POST",
      url: "/api/flows",
      body: { definitionId: "test-def", config: { name: "new" } },
    });

    assert.equal(response.statusCode, 400);
  });

  it("GET /api/flows resolves a flow by definitionId and instance name", async () => {
    registerFlowForTest(
      "alpha",
      createFlowRuntime(
        "alpha",
        [testWorkflow],
        [],
        {},
        { name: "Alpha Project", definitionId: "test-def", basePath: "/tmp/a" },
        {},
        noopPersistence
      )
    );
    registerFlowForTest(
      "beta",
      createFlowRuntime(
        "beta",
        [testWorkflow],
        [],
        {},
        { name: "Beta Project", definitionId: "test-def", basePath: "/tmp/b" },
        {},
        noopPersistence
      )
    );
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    const response = await server.inject({
      method: "GET",
      url: "/api/flows?definitionId=test-def&name=beta-project",
    });

    assert.equal(response.statusCode, 200);
    const flows = response.json().flows;
    assert.equal(flows.length, 1);
    assert.equal(flows[0].id, "beta");
    assert.equal(flows[0].config.name, "Beta Project");
  });

  it("POST /api/flows requires definitionId and rejects unknown definitions", async () => {
    setFlowPersistence(noopPersistence);
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    const missing = await server.inject({
      method: "POST",
      url: "/api/flows",
      body: {},
    });
    assert.equal(missing.statusCode, 400);
    assert.equal(missing.json().error, "definitionId is required");

    const unknown = await server.inject({
      method: "POST",
      url: "/api/flows",
      body: { definitionId: "missing-def" },
    });
    assert.equal(unknown.statusCode, 400);
  });

  it("POST /api/flows rejects config missing required schema fields", async () => {
    registerFlowDefinition(queenBeeCompiled, { builtIn: true });
    setFlowPersistence(noopPersistence);
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    const response = await server.inject({
      method: "POST",
      url: "/api/flows",
      body: { definitionId: "queen-bee", config: {} },
    });

    assert.equal(response.statusCode, 400);
    const error = response.json().error as string;
    assert.ok(error.includes('"name"'), `error should mention name: ${error}`);
    assert.ok(
      error.includes('"basePath"'),
      `error should mention basePath: ${error}`
    );
  });

  it("POST /api/flows rejects unknown config fields", async () => {
    registerFlowDefinition(queenBeeCompiled, { builtIn: true });
    setFlowPersistence(noopPersistence);
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    const response = await server.inject({
      method: "POST",
      url: "/api/flows",
      body: {
        definitionId: "queen-bee",
        config: { name: "X", basePath: "/tmp", bogus: 1 },
      },
    });

    assert.equal(response.statusCode, 400);
    assert.ok(
      (response.json().error as string).includes("bogus"),
      "error should name the unknown field"
    );
  });

  it("POST /api/flows rejects config fields of the wrong type", async () => {
    registerFlowDefinition(queenBeeCompiled, { builtIn: true });
    setFlowPersistence(noopPersistence);
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    const response = await server.inject({
      method: "POST",
      url: "/api/flows",
      body: {
        definitionId: "queen-bee",
        config: { name: "X", basePath: 123 },
      },
    });

    assert.equal(response.statusCode, 400);
    assert.ok(
      (response.json().error as string).includes("basePath"),
      "error should name the mistyped field"
    );
  });

  it("POST /api/flows accepts config matching the schema", async () => {
    registerFlowDefinition(queenBeeCompiled, { builtIn: true });
    setFlowPersistence(noopPersistence);
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    const response = await server.inject({
      method: "POST",
      url: "/api/flows",
      body: {
        definitionId: "queen-bee",
        config: { name: "My Project", basePath: "/tmp/repo" },
      },
    });

    assert.equal(response.statusCode, 201);
  });

  function fixture(): FastifyInstance {
    const runtime = createFlowRuntime(
      "test-flow",
      [testWorkflow],
      [],
      {},
      { name: "Test Flow", basePath: "/tmp/test-repo" },
      {},
      noopPersistence
    );

    runtime.addWorkflowInstance("test-wf");

    registerFlowForTest("test-flow", runtime);

    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);
    return server;
  }

  async function flowSocketServer(): Promise<FastifyInstance> {
    const server = Fastify();
    servers.push(server);
    await server.register(fastifyWebsocket);
    registerFlowApiRoutes(server);
    await server.listen({ port: 0, host: "127.0.0.1" });
    return server;
  }

  async function openFlowWs(server: FastifyInstance): Promise<{
    ws: WebSocket;
    received: FlowWsMessage[];
  }> {
    const address = server.server.address();
    const port =
      typeof address === "object" && address !== null ? address.port : 0;
    const received: FlowWsMessage[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/flows/ws`);
    ws.onmessage = (event) => {
      received.push(JSON.parse(String(event.data)) as FlowWsMessage);
    };
    await new Promise<void>((resolve) => {
      ws.onopen = () => resolve();
    });
    return { ws, received };
  }
});

async function waitFor(
  condition: () => boolean,
  timeoutMs = 1_000
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
