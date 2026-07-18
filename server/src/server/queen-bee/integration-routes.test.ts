import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import type { ProjectListItem } from "shared/project-types";
import type { ProjectStore } from "./create-project-store";
import type {
  IntegrationManager,
  IntegrationStatus,
} from "./integration-manager";
import { registerIntegrationRoutes } from "./integration-routes";

describe("integration routes", () => {
  const servers: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it("reports integration status for the project's target branch", async () => {
    const calls: string[] = [];
    const server = fixture(calls);

    const response = await server.inject({
      method: "GET",
      url: "/api/queen-bee/project-1/integration",
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().state, "ready");
    assert.deepEqual(calls, ["status:main"]);
  });

  it("integrates only through the explicit mutation endpoint", async () => {
    const calls: string[] = [];
    const server = fixture(calls);

    const response = await server.inject({
      method: "POST",
      url: "/api/queen-bee/project-1/integration/integrate",
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().state, "integrated");
    assert.deepEqual(calls, ["integrate:main"]);
  });

  function fixture(calls: string[]): FastifyInstance {
    const project: ProjectListItem = {
      id: "project-1",
      name: "Project",
      repoPath: "/project",
      createdAt: "",
      systemPrompt: "",
      codingGuidelines: "",
      targetBranch: "main",
    };
    const projectStore: ProjectStore = {
      getAll: () => [project],
      create: () => {
        throw new Error("Not used");
      },
      unlink: () => {},
    };
    const integrationManager: IntegrationManager = {
      ensure: () => ({ branchName: "hive-main", revision: "hive-1" }),
      status: (_repoPath, targetBranch) => {
        calls.push(`status:${targetBranch}`);
        return status("ready");
      },
      integrate: (_repoPath, targetBranch) => {
        calls.push(`integrate:${targetBranch}`);
        return status("integrated");
      },
      assertCurrent: () => {},
      accept: () => ({ branchName: "hive-main", revision: "hive-1" }),
      discardWorktree: () => {},
      commitPlanningSnapshot: () => ({
        branchName: "hive-main",
        revision: "hive-1",
      }),
    };
    const server = Fastify();
    servers.push(server);
    registerIntegrationRoutes(server, { projectStore, integrationManager });
    return server;
  }
});

function status(state: IntegrationStatus["state"]): IntegrationStatus {
  return {
    branchName: "hive-main",
    revision: "hive-1",
    targetBranch: "main",
    targetRevision: state === "integrated" ? "hive-1" : "main-1",
    state,
    ahead: state === "ready" ? 1 : 0,
    behind: 0,
    canIntegrate: state === "ready",
  };
}
