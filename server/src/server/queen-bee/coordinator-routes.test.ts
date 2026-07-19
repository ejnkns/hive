import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import type { ProjectListItem } from "shared/project-types";
import { createBoardStore } from "./board-store";
import { registerCoordinatorRoutes } from "./coordinator-routes";
import type { ProjectStore } from "./create-project-store";
import type { RequirementsSessionManager } from "./devise-engine";
import type { PlanningManager } from "./planner";
import { createQueenBeeRuntimeStore } from "./queen-bee-runtime-store";

describe("coordinator routes", () => {
  const directories: string[] = [];
  const servers: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("starts a card-scoped devise session for redevise remediation", async () => {
    const repoPath = mkdtempSync(join(tmpdir(), "hive-coordinator-routes-"));
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
    const card = boardStore.addCard(project.id, project.repoPath, {
      title: "Resolve requirements conflict",
      description: "The worker found ambiguous scope",
      acceptanceCriteria: ["The scope is confirmed"],
      relevantFiles: ["src/feature.ts"],
      dependencies: [],
      column: "unfulfillable",
      coordinatorLog: {
        status: "complete",
        suggestions: [
          {
            id: "suggestion-1",
            action: "redevise",
            rationale: "Ask the user which behavior should win",
          },
          {
            id: "suggestion-2",
            action: "retry_with_patch",
            rationale: "Apply a requirements-aligned patch",
            cardPatch: { description: "Patched description" },
            requirementsContent: "# Patched requirements",
          },
          {
            id: "suggestion-3",
            action: "archive",
            rationale: "The feature is no longer required",
            requirementsContent: "# Requirements without abandoned scope",
          },
        ],
      },
    });
    let startCardArgs: unknown[] | undefined;
    const engine: RequirementsSessionManager = {
      start: async () => ({ question: "Question" }),
      startRevision: async () => ({ question: "Question" }),
      startIdea: async () => ({ question: "Question" }),
      startRepair: async () => ({ question: "Question" }),
      respond: async () => ({ type: "question", question: "Question" }),
      respondIdea: async () => ({ type: "question", question: "Question" }),
      getSession: () => undefined,
      getIdeaSession: () => undefined,
      async startCard(...args) {
        startCardArgs = args;
        return { question: "Which behavior should win?" };
      },
      respondCard: async () => ({
        type: "question",
        question: "Card question",
      }),
      getCardSession: () => undefined,
    };
    const server = Fastify();
    servers.push(server);
    let plannerRequirements = "";
    let plannerDisposition: unknown;
    const planner: PlanningManager = {
      async propose(
        projectId,
        _repoPath,
        proposedRequirements,
        _guidance,
        disposition
      ) {
        plannerRequirements = proposedRequirements;
        plannerDisposition = disposition;
        return {
          id: "proposal-1",
          projectId,
          status: "pending",
          baseRequirementsRevision: "requirements-1",
          baseBoardRevision: "board-1",
          projectRevision: "revision-1",
          runKind: "requirements_reconciliation",
          proposedRequirements,
          changes: [],
          createdAt: "2026-07-19T00:02:00.000Z",
        };
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
    };
    registerCoordinatorRoutes(server, {
      boardStore,
      projectStore,
      sessionManager: engine,
      planningManager: planner,
    });

    const response = await server.inject({
      method: "POST",
      url: `/api/queen-bee/${project.id}/cards/${card.id}/remediate`,
      payload: { action: "redevise", suggestionId: "suggestion-1" },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().redevise, true);
    assert.equal(response.json().question, "Which behavior should win?");
    assert.equal(response.json().card.column, "unfulfillable");
    assert.equal(startCardArgs?.[0], project.id);
    assert.equal(startCardArgs?.[1], card.id);
    assert.match(String(startCardArgs?.[2]), /which behavior should win/i);

    const retryResponse = await server.inject({
      method: "POST",
      url: `/api/queen-bee/${project.id}/cards/${card.id}/remediate`,
      payload: { action: "retry_with_patch", suggestionId: "suggestion-2" },
    });

    assert.equal(retryResponse.statusCode, 200);
    assert.equal(retryResponse.json().proposal.id, "proposal-1");
    assert.equal(plannerRequirements, "# Patched requirements");
    assert.equal(
      boardStore.getBoard(project.id, project.repoPath).cards[0]?.description,
      "The worker found ambiguous scope"
    );

    const archiveResponse = await server.inject({
      method: "POST",
      url: `/api/queen-bee/${project.id}/cards/${card.id}/remediate`,
      payload: { action: "archive", suggestionId: "suggestion-3" },
    });

    assert.equal(archiveResponse.statusCode, 200);
    assert.equal(plannerRequirements, "# Requirements without abandoned scope");
    assert.deepEqual(plannerDisposition, {
      cardId: card.id,
      target: "archived",
    });
    assert.equal(
      boardStore.getBoard(project.id, project.repoPath).cards[0]?.archivedAt,
      undefined
    );
  });
});
