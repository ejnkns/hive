import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import type { ProjectListItem } from "shared/project-types";
import type { ProjectStore } from "./create-project-store";
import { registerProjectRoutes } from "./project-routes";

describe("project routes", () => {
  const servers: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it("updates the supported parallel Worker setting", async () => {
    const project = fixtureProject();
    let savedValue = 0;
    const server = Fastify();
    servers.push(server);
    registerProjectRoutes(server, {
      ...unusedStore(project),
      updateMaxConcurrentWorkers(_id, value) {
        savedValue = value;
        return { ...project, maxConcurrentWorkers: value };
      },
    });

    const response = await server.inject({
      method: "PATCH",
      url: "/api/queen-bee/projects/project-1/config",
      payload: { maxConcurrentWorkers: 5 },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(savedValue, 5);
    assert.equal(response.json().project.maxConcurrentWorkers, 5);
  });

  it("rejects a missing parallel Worker value", async () => {
    const project = fixtureProject();
    const server = Fastify();
    servers.push(server);
    registerProjectRoutes(server, unusedStore(project));

    const response = await server.inject({
      method: "PATCH",
      url: "/api/queen-bee/projects/project-1/config",
      payload: {},
    });

    assert.equal(response.statusCode, 400);
  });
});

function fixtureProject(): ProjectListItem {
  return {
    id: "project-1",
    name: "Project",
    repoPath: "/tmp/project-1",
    createdAt: "",
    systemPrompt: "",
    codingGuidelines: "",
    targetBranch: "main",
    maxConcurrentWorkers: 3,
  };
}

function unusedStore(project: ProjectListItem): ProjectStore {
  return {
    getAll: () => [project],
    create: () => {
      throw new Error("Not used");
    },
    updateMaxConcurrentWorkers: () => {
      throw new Error("Not used");
    },
    unlink: () => {},
  };
}
