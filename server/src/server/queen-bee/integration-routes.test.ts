import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import {
  createFlowRuntime,
  type FlowPersistence,
} from "workflow-engine/create-flow-runtime";
import { registerFlowForTest } from "../flow-registry";
import { registerIntegrationRoutes } from "./integration-routes";

describe("integration routes", () => {
  const servers: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it("reports integration status for the project's target branch", async () => {
    const server = fixture();

    const response = await server.inject({
      method: "GET",
      url: "/api/queen-bee/project-1/integration",
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().state, "ready");
  });

  it("integrates only through the explicit mutation endpoint", async () => {
    const server = fixture();

    const response = await server.inject({
      method: "POST",
      url: "/api/queen-bee/project-1/integration/integrate",
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().state, "integrated");
  });

  function fixture(): FastifyInstance {
    const repoPath = mkdtempSync(join("/tmp", "integration-test-"));
    execSync("git init", { cwd: repoPath, encoding: "utf-8" });
    execSync('git config user.email "test@test.com"', {
      cwd: repoPath,
      encoding: "utf-8",
    });
    execSync('git config user.name "Test"', {
      cwd: repoPath,
      encoding: "utf-8",
    });
    execSync('git commit --allow-empty -m "initial"', {
      cwd: repoPath,
      encoding: "utf-8",
    });
    execSync("git branch -m main", { cwd: repoPath, encoding: "utf-8" });
    execSync("git branch hive-main main", { cwd: repoPath, encoding: "utf-8" });
    // hive-main ahead of main → "ready" state
    execSync("git checkout hive-main", { cwd: repoPath, encoding: "utf-8" });
    execSync("git commit --allow-empty -m 'integration commit'", {
      cwd: repoPath,
      encoding: "utf-8",
    });
    execSync("git checkout main", { cwd: repoPath, encoding: "utf-8" });

    const persistence: FlowPersistence = {
      saveFlow: () => {},
      saveInstance: () => {},
      saveRunningTaskContext: () => {},
      loadFlow: () => null,
      loadAllFlows: () => [],
    };

    const runtime = createFlowRuntime(
      "project-1",
      [],
      [],
      {},
      {
        repoPath,
        targetBranch: "main",
      },
      {},
      persistence
    );
    registerFlowForTest("project-1", runtime);

    const server = Fastify();
    servers.push(server);
    registerIntegrationRoutes(server);
    return server;
  }
});
