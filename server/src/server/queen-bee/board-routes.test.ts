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
import type { PlanningManager } from "./planner";
import { createQueenBeeRuntimeStore } from "./queen-bee-runtime-store";

describe("board routes", () => {
  const directories: string[] = [];
  const servers: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("creates a provisional Idea instead of an executable Card", async () => {
    const { server, boardStore, project } = createRouteFixture();
    const response = await server.inject({
      method: "POST",
      url: `/api/queen-bee/${project.id}/ideas`,
      payload: { title: "Dark mode", brief: "Add a dark appearance" },
    });

    assert.equal(response.statusCode, 201);
    assert.equal(response.json().idea.title, "Dark mode");
    const board = boardStore.getBoard(project.id, project.repoPath);
    assert.equal(board.ideas.length, 1);
    assert.equal(board.cards.length, 0);
  });

  it("requires a title and brief when capturing an Idea", async () => {
    const { server, project } = createRouteFixture();
    const response = await server.inject({
      method: "POST",
      url: `/api/queen-bee/${project.id}/ideas`,
      payload: { title: "Incomplete" },
    });
    assert.equal(response.statusCode, 400);
    assert.match(response.json().error, /brief/);
  });

  it("archives an Idea without creating or moving a Card", async () => {
    const { server, boardStore, project } = createRouteFixture();
    const idea = boardStore.addIdea(project.id, project.repoPath, {
      title: "Later",
      brief: "Not currently wanted",
    });
    const response = await server.inject({
      method: "POST",
      url: `/api/queen-bee/${project.id}/ideas/${idea.id}/archive`,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(
      boardStore.getBoard(project.id, project.repoPath).ideas.length,
      0
    );
  });

  it("does not expose a manual Card movement endpoint", async () => {
    const { server, boardStore, project } = createRouteFixture();
    const card = boardStore.addCard(project.id, project.repoPath, {
      title: "Approved work",
      description: "Already planned",
      acceptanceCriteria: ["It works"],
      relevantFiles: ["source.ts"],
      dependencies: [],
      column: "ready",
    });
    const response = await server.inject({
      method: "PATCH",
      url: `/api/queen-bee/${project.id}/cards/${card.id}`,
      payload: { column: "in_progress" },
    });
    assert.equal(response.statusCode, 404);
  });

  it("replans rejected Card changes with explicit Planning Feedback", async () => {
    let receivedGuidance = "";
    let previousCancelled = false;
    const previous = {
      id: "proposal-1",
      projectId: "project-1",
      status: "pending" as const,
      baseRequirementsRevision: "requirements-1",
      baseBoardRevision: "board-1",
      projectRevision: "revision-1",
      runKind: "requirements_reconciliation" as const,
      proposedRequirements: "# Proposed requirements",
      changes: [],
      createdAt: "2026-07-20T00:00:00.000Z",
    };
    const { server, project } = createRouteFixture({
      getProposal: () => previous,
      async propose(
        projectId,
        _repoPath,
        proposedRequirements,
        guidance,
        disposition
      ) {
        receivedGuidance = guidance ?? "";
        assert.deepEqual(disposition, {
          proposalId: previous.id,
          target: "replanned",
        });
        return {
          ...previous,
          id: "proposal-2",
          projectId,
          proposedRequirements,
          runKind: "card_replanning",
        };
      },
      cancelProposal: () => {
        previousCancelled = true;
        return { ...previous, status: "cancelled" };
      },
    });

    const response = await server.inject({
      method: "POST",
      url: `/api/queen-bee/${project.id}/planning/${previous.id}/replan`,
      payload: {
        guidance: "Split the work into two independently useful Cards",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().proposal.runKind, "card_replanning");
    assert.match(receivedGuidance, /Split the work/);
    assert.equal(previousCancelled, true);
  });

  function createRouteFixture(plannerOverrides: Partial<PlanningManager> = {}) {
    const repoPath = mkdtempSync(join(tmpdir(), "hive-board-routes-"));
    directories.push(repoPath);
    const project: ProjectListItem = {
      id: "project-1",
      name: "Project",
      repoPath,
      createdAt: "",
      systemPrompt: "",
      codingGuidelines: "",
      targetBranch: "main",
      maxConcurrentWorkers: 3,
    };
    const projectStore: ProjectStore = {
      getAll: () => [project],
      create: () => {
        throw new Error("Not used");
      },
      updateMaxConcurrentWorkers: () => project,
      unlink: () => {},
    };
    const boardStore = createBoardStore(
      () => {},
      createQueenBeeRuntimeStore(join(repoPath, ".runtime"))
    );
    const planner: PlanningManager = {
      propose: async () => {
        throw new Error("Not used");
      },
      decide: () => {
        throw new Error("Not used");
      },
      acceptAll: () => [],
      apply: () => [],
      getProposal: () => null,
      getRequirementsFeedback: () => null,
      getOpenOutcome: () => null,
      resolveRequirementsFeedback: () => {
        throw new Error("Not used");
      },
      cancelProposal: () => {
        throw new Error("Not used");
      },
      ...plannerOverrides,
    };
    const server = Fastify();
    servers.push(server);
    registerBoardRoutes(server, {
      boardStore,
      planningManager: planner,
      projectStore,
    });
    return { server, boardStore, project };
  }
});
