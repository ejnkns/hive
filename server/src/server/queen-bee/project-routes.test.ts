import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import type { FlowPersistence } from "workflow-engine/create-flow-runtime";
import { createFlowRuntime } from "workflow-engine/create-flow-runtime";
import { registerFlowForTest } from "../flow-registry";
import { registerProjectRoutes } from "./project-routes";

describe("project routes", () => {
  const servers: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it("updates the supported parallel Worker setting", async () => {
    const persistence: FlowPersistence = {
      saveFlow: () => {},
      saveInstance: () => {},
      saveRunningTaskContext: () => {},
      deleteFlow: () => {},
      loadFlow: () => null,
      loadAllFlows: () => [],
    };

    const runtime = createFlowRuntime(
      "project-1",
      [],
      [],
      {},
      {
        repoPath: "/tmp/project-1",
        name: "Project",
        maxConcurrentWorkers: 3,
        targetBranch: "main",
      },
      {},
      persistence
    );
    registerFlowForTest("project-1", runtime);

    const server = Fastify();
    servers.push(server);
    registerProjectRoutes(server, persistence);

    const response = await server.inject({
      method: "PATCH",
      url: "/api/queen-bee/projects/project-1/config",
      payload: { maxConcurrentWorkers: 5 },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().project.maxConcurrentWorkers, 5);
  });

  it("rejects a missing parallel Worker value", async () => {
    const persistence: FlowPersistence = {
      saveFlow: () => {},
      saveInstance: () => {},
      saveRunningTaskContext: () => {},
      deleteFlow: () => {},
      loadFlow: () => null,
      loadAllFlows: () => [],
    };

    const server = Fastify();
    servers.push(server);
    registerProjectRoutes(server, persistence);

    const response = await server.inject({
      method: "PATCH",
      url: "/api/queen-bee/projects/project-1/config",
      payload: {},
    });

    assert.equal(response.statusCode, 400);
  });
});
