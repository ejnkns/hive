import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import type { ProjectListItem } from "shared/project-types";
import { registerBoardRoutes } from "./board-routes";
import { createBoardStore } from "./board-store";
import type { ProjectStore } from "./create-project-store";
import { createRequirementsSessionManager } from "./devise-engine";
import type { AgentModelCaller } from "./devise-engine/create-devise-model-caller";
import { registerRequirementsRoutes } from "./devise-routes";
import type { IntegrationManager } from "./integration-manager";
import { createPlanningManager } from "./planner";
import { createQueenBeeRuntimeStore } from "./queen-bee-runtime-store";
import { readRequirements, writeRequirements } from "./requirements-store";

describe("initial planning flow", () => {
  const directories: string[] = [];
  const servers: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("recovers a failed plan, accepts it, and restores the board after restart", async () => {
    const repoPath = mkdtempSync(join(tmpdir(), "hive-initial-flow-"));
    directories.push(repoPath);
    writeRequirements(repoPath, "");
    const project = projectAt(repoPath);
    const projectStore = projectStoreFor(project);
    const runtimeStore = createQueenBeeRuntimeStore(join(repoPath, ".runtime"));
    const boardStore = createBoardStore(() => {}, runtimeStore);
    const sessionManager = createRequirementsSessionManager(
      requirementsCaller(),
      runtimeStore
    );
    let planningAttempts = 0;
    const planningManager = createPlanningManager(
      boardStore,
      runtimeStore,
      integrationManager(),
      {
        async call() {
          planningAttempts += 1;
          if (planningAttempts === 1) {
            throw new Error("Planner temporarily unavailable");
          }
          return {
            content: `\`\`\`json\n${JSON.stringify({
              changes: [
                {
                  action: "create",
                  rationale: "Deliver the approved initial scope",
                  proposedCard: {
                    title: "Initial Card",
                    description: "Implement the initial project behavior",
                    acceptanceCriteria: ["The initial behavior works"],
                    relevantFiles: ["source.ts"],
                    dependencies: [],
                    requirementRefs: ["FR-1"],
                  },
                },
              ],
            })}\n\`\`\``,
            toolCalls: [],
            finishReason: "stop",
          };
        },
      }
    );
    const firstServer = registerFlowServer({
      boardStore,
      planningManager,
      projectStore,
      sessionManager,
    });

    const started = await firstServer.inject({
      method: "POST",
      url: `/api/queen-bee/${project.id}/requirements/start`,
      payload: { prompt: "Build the initial project" },
    });
    assert.equal(started.statusCode, 200);

    const completed = await firstServer.inject({
      method: "POST",
      url: `/api/queen-bee/${project.id}/requirements/respond`,
      payload: { answer: "The draft is complete" },
    });
    assert.equal(completed.statusCode, 200);
    assert.equal(completed.json().complete, true);

    const failedPlan = await firstServer.inject({
      method: "POST",
      url: `/api/queen-bee/${project.id}/requirements/approve`,
    });
    assert.equal(failedPlan.statusCode, 500);
    assert.equal(failedPlan.json().error, "Planner temporarily unavailable");
    assert.equal(sessionManager.getSession(project.id)?.status, "complete");
    assert.deepEqual(runtimeStore.getPlanningProposals(project.id), []);

    const retriedPlan = await firstServer.inject({
      method: "POST",
      url: `/api/queen-bee/${project.id}/requirements/approve`,
    });
    assert.equal(retriedPlan.statusCode, 200);
    const proposalId: unknown = retriedPlan.json().proposal?.id;
    assert.equal(typeof proposalId, "string");
    assert.equal(sessionManager.getSession(project.id)?.status, "submitted");

    const historicalSession = await firstServer.inject({
      method: "GET",
      url: `/api/queen-bee/${project.id}/requirements/session`,
    });
    assert.deepEqual(historicalSession.json(), {
      active: false,
      status: "submitted",
    });

    await firstServer.close();
    servers.splice(servers.indexOf(firstServer), 1);
    const restartedSessionManager = createRequirementsSessionManager(
      undefined,
      runtimeStore
    );
    const restartedPlanningManager = createPlanningManager(
      boardStore,
      runtimeStore,
      integrationManager(),
      unavailableCaller()
    );
    const restartedServer = registerFlowServer({
      boardStore,
      planningManager: restartedPlanningManager,
      projectStore,
      sessionManager: restartedSessionManager,
    });

    const restoredPlan = await restartedServer.inject({
      method: "GET",
      url: `/api/queen-bee/${project.id}/planning/open`,
    });
    assert.equal(restoredPlan.json().proposal.id, proposalId);

    const accepted = await restartedServer.inject({
      method: "POST",
      url: `/api/queen-bee/${project.id}/planning/${proposalId}/accept-all`,
    });
    assert.equal(accepted.statusCode, 200);
    assert.equal(accepted.json().cards[0].column, "ready");
    assert.equal(readRequirements(repoPath), "# Approved requirements");

    const boardAfterAcceptance = await restartedServer.inject({
      method: "GET",
      url: `/api/queen-bee/${project.id}/board`,
    });
    assert.deepEqual(
      boardAfterAcceptance
        .json()
        .cards.map((card: { title: string }) => card.title),
      ["Initial Card"]
    );
    const noOpenPlan = await restartedServer.inject({
      method: "GET",
      url: `/api/queen-bee/${project.id}/planning/open`,
    });
    assert.deepEqual(noOpenPlan.json(), {});
  });

  function registerFlowServer(
    deps: Parameters<typeof registerRequirementsRoutes>[1]
  ): FastifyInstance {
    const server = Fastify();
    servers.push(server);
    registerRequirementsRoutes(server, deps);
    registerBoardRoutes(server, deps);
    return server;
  }
});

function requirementsCaller(): AgentModelCaller {
  let callCount = 0;
  return {
    async call() {
      callCount += 1;
      if (callCount === 1) {
        return {
          content: "What outcome should the project provide?",
          toolCalls: [],
          finishReason: "stop",
        };
      }
      if (callCount === 2) {
        return {
          content: "",
          toolCalls: [
            {
              id: "draft-1",
              name: "update_requirements_draft",
              arguments: JSON.stringify({
                content: "# Approved requirements",
              }),
            },
          ],
          finishReason: "tool_calls",
        };
      }
      return {
        content: "REQUIREMENTS_COMPLETE\nThe draft is ready for planning.",
        toolCalls: [],
        finishReason: "stop",
      };
    },
  };
}

function unavailableCaller(): AgentModelCaller {
  return {
    async call() {
      throw new Error("Model calls are not expected after restart");
    },
  };
}

function projectAt(repoPath: string): ProjectListItem {
  return {
    id: "project-1",
    name: "Project",
    repoPath,
    createdAt: "2026-07-20T00:00:00.000Z",
    systemPrompt: "",
    codingGuidelines: "",
    targetBranch: "main",
    maxConcurrentWorkers: 3,
  };
}

function projectStoreFor(project: ProjectListItem): ProjectStore {
  return {
    getAll: () => [project],
    create: () => {
      throw new Error("Not used");
    },
    updateMaxConcurrentWorkers: () => project,
    unlink: () => {},
  };
}

function integrationManager(): IntegrationManager {
  return {
    ensure: () => ({ branchName: "hive-main", revision: "integration-1" }),
    status: () => ({
      branchName: "hive-main",
      revision: "integration-1",
      targetBranch: "main",
      targetRevision: "target-1",
      state: "ready",
      ahead: 1,
      behind: 0,
      canIntegrate: true,
    }),
    integrate: () => {
      throw new Error("Not used");
    },
    reviewReadiness: () => {
      throw new Error("Not used");
    },
    assertCurrent: () => {},
    accept: () => {
      throw new Error("Not used");
    },
    discardWorktree: () => {},
    commitPlanningSnapshot: () => ({
      branchName: "hive-main",
      revision: "integration-2",
    }),
  };
}
