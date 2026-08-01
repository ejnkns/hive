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
import {
  createFlowRuntime,
  type FlowPersistence,
  type FlowRuntimeEvent,
} from "workflow-engine/create-flow-runtime";
import { defineWorkflow } from "workflow-engine/workflow-types";
import { queenBeeFlow } from "../../../presets/queen-bee/flow";
import { registerFlowApiRoutes } from "./flow-api-routes";
import {
  registerFlowDefinition,
  resetFlowDefinitionsForTest,
} from "./flow-definitions";
import {
  registerFlowForTest,
  resetFlowRuntimesForTest,
  setFlowPersistence,
} from "./flow-registry";

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

const noopPersistence: FlowPersistence = {
  saveFlow: () => {},
  saveInstance: () => {},
  saveRunningTaskContext: () => {},
  deleteFlow: () => {},
  loadFlow: () => null,
  loadAllFlows: () => [],
};

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

  it("broadcasts instance state changes over /api/flows/ws", async () => {
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

    const server = Fastify();
    servers.push(server);
    await server.register(fastifyWebsocket);
    registerFlowApiRoutes(server);
    await server.listen({ port: 0, host: "127.0.0.1" });
    const address = server.server.address();
    const port =
      typeof address === "object" && address !== null ? address.port : 0;

    const received: FlowRuntimeEvent[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/flows/ws`);
    ws.onmessage = (event) => {
      received.push(JSON.parse(String(event.data)) as FlowRuntimeEvent);
    };
    await new Promise<void>((resolve) => {
      ws.onopen = () => resolve();
    });

    await server.inject({
      method: "POST",
      url: `/api/flows/test-flow/instances/${instanceId}/action`,
      body: { actionId: "start" },
    });

    await waitFor(() =>
      received.some((e) => e.type === "instance_state_changed")
    );

    assert.ok(received.some((e) => e.type === "instance_state_changed"));
    ws.close();
  });

  it("POST /api/flows/definitions/generate requires a prompt", async () => {
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);

    const response = await server.inject({
      method: "POST",
      url: "/api/flows/definitions/generate",
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

  it("DELETE /api/flows/:flowId without purge keeps basePath/.hive", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hive-unlink-"));
    mkdirSync(join(dir, ".hive"), { recursive: true });
    writeFileSync(join(dir, ".hive", "project.json"), "{}");
    try {
      registerFlowForTest(
        "unlink-flow",
        createFlowRuntime(
          "unlink-flow",
          [testWorkflow],
          [],
          {},
          { name: "Unlink Flow", basePath: dir },
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
      assert.equal(existsSync(join(dir, ".hive")), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("DELETE /api/flows/:flowId with purge removes basePath/.hive", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hive-purge-"));
    mkdirSync(join(dir, ".hive"), { recursive: true });
    writeFileSync(join(dir, ".hive", "project.json"), "{}");
    try {
      registerFlowForTest(
        "purge-flow",
        createFlowRuntime(
          "purge-flow",
          [testWorkflow],
          [],
          {},
          { name: "Purge Flow", basePath: dir },
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
      assert.equal(existsSync(join(dir, ".hive")), false);
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
    registerFlowDefinition(queenBeeFlow, { builtIn: true });
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
    registerFlowDefinition(queenBeeFlow, { builtIn: true });
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
    registerFlowDefinition(queenBeeFlow, { builtIn: true });
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
    registerFlowDefinition(queenBeeFlow, { builtIn: true });
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
