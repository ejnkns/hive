import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import type { RequirementsFeedback } from "shared/board-types";
import type { ProjectListItem } from "shared/project-types";
import { createBoardStore } from "./board-store";
import type { ProjectStore } from "./create-project-store";
import type { RequirementsSessionManager } from "./devise-engine";
import { registerRequirementsRoutes } from "./devise-routes";
import type { PlanningManager } from "./planner";
import { createQueenBeeRuntimeStore } from "./queen-bee-runtime-store";
import {
  readRequirements,
  requirementsRevision,
  writeRequirements,
} from "./requirements-store";

describe("requirements routes", () => {
  const directories: string[] = [];
  const servers: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("requires explicit confirmation before revising around active work", async () => {
    let starts = 0;
    const { server, boardStore, project } = createRouteFixture({
      async startRevision() {
        starts += 1;
        return { question: "What should change?" };
      },
    });
    boardStore.addCard(project.id, project.repoPath, {
      title: "Active card",
      description: "Work is underway",
      acceptanceCriteria: ["The worker is active"],
      relevantFiles: [],
      dependencies: [],
      column: "in_progress",
    });

    const blocked = await server.inject({
      method: "POST",
      url: `/api/queen-bee/${project.id}/requirements/revision/start`,
      payload: { prompt: "Change the scope" },
    });
    assert.equal(blocked.statusCode, 409);
    assert.equal(blocked.json().requiresConfirmation, true);
    assert.equal(starts, 0);

    const confirmed = await server.inject({
      method: "POST",
      url: `/api/queen-bee/${project.id}/requirements/revision/start`,
      payload: { prompt: "Change the scope", confirmActive: true },
    });
    assert.equal(confirmed.statusCode, 200);
    assert.equal(starts, 1);
  });

  it("replaces an explicitly identified pending Planning Proposal", async () => {
    const proposal = {
      id: "proposal-1",
      projectId: "project-1",
      status: "pending" as const,
      baseRequirementsRevision: "requirements-1",
      baseBoardRevision: "board-1",
      projectRevision: null,
      runKind: "requirements_reconciliation" as const,
      proposedRequirements: "# Proposed",
      changes: [],
      createdAt: "2026-07-20T00:00:00.000Z",
    };
    let allowedProposalId: string | undefined;
    let cancelledProposalId = "";
    const { server, project } = createRouteFixture(
      {
        async startRevision(
          _projectId,
          _prompt,
          _workspacePath,
          replacesProposalId
        ) {
          allowedProposalId = replacesProposalId;
          return { question: "What should change?" };
        },
      },
      {
        getProposal: () => proposal,
        cancelProposal: (_projectId, proposalId) => {
          cancelledProposalId = proposalId;
          return { ...proposal, status: "cancelled" };
        },
      }
    );

    const response = await server.inject({
      method: "POST",
      url: `/api/queen-bee/${project.id}/requirements/revision/start`,
      payload: { prompt: "Change the scope", proposalId: proposal.id },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(allowedProposalId, proposal.id);
    assert.equal(cancelledProposalId, proposal.id);
  });

  it("starts Idea Elaboration with the persisted source Idea", async () => {
    let startedIdeaId = "";
    const { server, boardStore, project } = createRouteFixture({
      async startIdea(_projectId, idea) {
        startedIdeaId = idea.id;
        return { question: "What outcome should this add?" };
      },
    });
    const idea = boardStore.addIdea(project.id, project.repoPath, {
      title: "Dark mode",
      brief: "Support a dark appearance",
    });

    const response = await server.inject({
      method: "POST",
      url: `/api/queen-bee/${project.id}/ideas/${idea.id}/requirements/start`,
      payload: {},
    });

    assert.equal(response.statusCode, 200);
    assert.equal(startedIdeaId, idea.id);
    assert.equal(response.json().question, "What outcome should this add?");
  });

  it("starts a fresh Requirements Repair from structured feedback", async () => {
    const feedback: RequirementsFeedback = {
      kind: "requirements_feedback",
      id: "feedback-1",
      projectId: "project-1",
      status: "pending",
      projectRevision: null,
      baseRequirementsRevision: requirementsRevision(""),
      baseBoardRevision: "board-1",
      proposedRequirements: "# Draft",
      createdAt: "2026-07-20T00:00:00.000Z",
      issues: [
        {
          requirementRefs: ["FR-1"],
          category: "missing_decision",
          explanation: "A decision is missing.",
          evidence: [],
          decisionNeeded: "Choose the behavior.",
          recommendation: "Preserve current behavior.",
        },
      ],
    };
    let repairedFeedbackId = "";
    const { server, project } = createRouteFixture(
      {
        async startRepair(_projectId, received) {
          repairedFeedbackId = received.id;
          return { question: "Which behavior should be canonical?" };
        },
      },
      {
        getRequirementsFeedback: () => feedback,
      }
    );

    const response = await server.inject({
      method: "POST",
      url: `/api/queen-bee/${project.id}/requirements-feedback/${feedback.id}/repair/start`,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(repairedFeedbackId, feedback.id);
    assert.equal(
      response.json().question,
      "Which behavior should be canonical?"
    );
  });

  it("rejects stale Requirements Feedback before starting repair", async () => {
    const feedback: RequirementsFeedback = {
      kind: "requirements_feedback",
      id: "feedback-stale",
      projectId: "project-1",
      status: "pending",
      projectRevision: null,
      baseRequirementsRevision: requirementsRevision("# Earlier"),
      baseBoardRevision: "board-1",
      proposedRequirements: "# Draft",
      createdAt: "2026-07-20T00:00:00.000Z",
      issues: [
        {
          requirementRefs: [],
          category: "scope_loss",
          explanation: "Scope was lost.",
          evidence: [],
          decisionNeeded: "Restore or remove it.",
          recommendation: "Restore it.",
        },
      ],
    };
    let starts = 0;
    const { server, project } = createRouteFixture(
      {
        async startRepair() {
          starts += 1;
          return { question: "Should not start" };
        },
      },
      { getRequirementsFeedback: () => feedback }
    );
    writeRequirements(project.repoPath, "# Current");

    const response = await server.inject({
      method: "POST",
      url: `/api/queen-bee/${project.id}/requirements-feedback/${feedback.id}/repair/start`,
    });

    assert.equal(response.statusCode, 409);
    assert.equal(starts, 0);
  });

  it("keeps Card authorship out of the Requirements Agent response", async () => {
    const { server, boardStore, project } = createRouteFixture({
      async respondCard() {
        return {
          type: "complete" as const,
          draftRequirements: "# Requirements\n\n- Refined behavior",
          spec: [
            "CARD_UPDATE",
            "```json",
            JSON.stringify({
              description: "Refined description",
              acceptanceCriteria: ["Refined behavior is verified"],
              relevantFiles: ["src/refined.ts"],
              requirementRefs: ["FR-2"],
            }),
            "```",
          ].join("\n"),
        };
      },
    });
    const card = boardStore.addCard(project.id, project.repoPath, {
      title: "New idea",
      description: "",
      acceptanceCriteria: [],
      relevantFiles: [],
      dependencies: [],
      column: "ready",
      handover: {
        problem: "Old requirements conflict",
        attempted: [],
        blockedBy: [],
        occurredAt: "",
      },
      coordinatorLog: { status: "complete", suggestions: [] },
    });

    const response = await server.inject({
      method: "POST",
      url: `/api/queen-bee/${project.id}/cards/${card.id}/requirements/respond`,
      payload: { answer: "That covers it" },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().complete, true);
    assert.equal(response.json().cardProposal, undefined);
    assert.match(response.json().draftRequirements, /Refined behavior/);
    assert.equal(
      boardStore
        .getBoard(project.id, project.repoPath)
        .cards.find((candidate) => candidate.id === card.id)?.description,
      ""
    );
  });

  it("rejects a card update when requirements were not updated", async () => {
    const { server, boardStore, project } = createRouteFixture({
      async respondCard() {
        return {
          type: "complete" as const,
          draftRequirements: "",
          spec: 'CARD_UPDATE\n```json\n{"description":"Card only"}\n```',
        };
      },
    });
    const card = boardStore.addCard(project.id, project.repoPath, {
      title: "Keep requirements aligned",
      description: "",
      acceptanceCriteria: [],
      relevantFiles: [],
      dependencies: [],
      column: "ready",
    });

    const response = await server.inject({
      method: "POST",
      url: `/api/queen-bee/${project.id}/cards/${card.id}/requirements/respond`,
      payload: { answer: "Done" },
    });

    assert.equal(response.statusCode, 422);
    assert.match(response.json().error, /requirements/i);
    assert.equal(
      boardStore.getBoard(project.id, project.repoPath).cards[0]?.description,
      ""
    );
  });

  it("turns an explicitly approved draft into a provisional planning proposal", async () => {
    const canonical = "# Requirements\n\n## Overview\nOriginal";
    const draft = "# Requirements\n\n## Overview\nApproved revision";
    const { server, project } = createRouteFixture({
      getSession() {
        return {
          sessionId: "session-1",
          projectId: project.id,
          messages: [],
          status: "complete",
          kind: "requirements_revision",
          baseRequirementsRevision: requirementsRevision(canonical),
          projectRevision: null,
          draftRequirements: draft,
          startedAt: "2026-07-19T00:00:00.000Z",
          updatedAt: "2026-07-19T00:01:00.000Z",
        };
      },
    });
    writeRequirements(project.repoPath, canonical);

    const response = await server.inject({
      method: "POST",
      url: `/api/queen-bee/${project.id}/requirements/approve`,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().proposal.proposedRequirements, draft);
    assert.equal(readRequirements(project.repoPath), canonical);
  });

  it("preserves source Idea lineage when an approved repair returns to planning", async () => {
    const canonical = "# Requirements\n\nOriginal";
    const draft = "# Requirements\n\nRepaired Idea";
    let receivedDisposition: unknown;
    const { server, project } = createRouteFixture(
      {
        getSession() {
          return {
            sessionId: "repair-1",
            projectId: project.id,
            sourceIdeaId: "idea-1",
            messages: [],
            status: "complete",
            kind: "requirements_repair",
            baseRequirementsRevision: requirementsRevision(canonical),
            projectRevision: null,
            draftRequirements: draft,
            startedAt: "2026-07-20T00:00:00.000Z",
            updatedAt: "2026-07-20T00:01:00.000Z",
          };
        },
      },
      {
        async propose(
          projectId,
          _repoPath,
          proposedRequirements,
          _guidance,
          disposition
        ) {
          receivedDisposition = disposition;
          return {
            id: "proposal-idea-1",
            projectId,
            status: "pending",
            baseRequirementsRevision: requirementsRevision(canonical),
            baseBoardRevision: "board-1",
            projectRevision: null,
            runKind: "idea_resolution",
            sourceIdeaId: "idea-1",
            proposedRequirements,
            changes: [],
            createdAt: "2026-07-20T00:02:00.000Z",
          };
        },
      }
    );
    writeRequirements(project.repoPath, canonical);

    const response = await server.inject({
      method: "POST",
      url: `/api/queen-bee/${project.id}/requirements/approve`,
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(receivedDisposition, {
      ideaId: "idea-1",
      target: "resolved",
    });
  });

  it("resolves repaired Requirements Feedback after planning succeeds", async () => {
    const canonical = "# Requirements\n\nOriginal";
    const draft = "# Requirements\n\nRepaired";
    let resolvedFeedbackId = "";
    const { server, project } = createRouteFixture(
      {
        getSession() {
          return {
            sessionId: "repair-1",
            projectId: project.id,
            sourceFeedbackId: "feedback-1",
            messages: [],
            status: "complete",
            kind: "requirements_repair",
            baseRequirementsRevision: requirementsRevision(canonical),
            projectRevision: null,
            draftRequirements: draft,
            startedAt: "2026-07-20T00:00:00.000Z",
            updatedAt: "2026-07-20T00:01:00.000Z",
          };
        },
      },
      {
        resolveRequirementsFeedback(_projectId, feedbackId) {
          resolvedFeedbackId = feedbackId;
          return {
            kind: "requirements_feedback",
            id: feedbackId,
            projectId: project.id,
            status: "resolved",
            projectRevision: null,
            baseRequirementsRevision: requirementsRevision(canonical),
            baseBoardRevision: "board-1",
            proposedRequirements: draft,
            issues: [],
            createdAt: "2026-07-20T00:00:00.000Z",
            resolvedAt: "2026-07-20T00:02:00.000Z",
          };
        },
      }
    );
    writeRequirements(project.repoPath, canonical);

    const response = await server.inject({
      method: "POST",
      url: `/api/queen-bee/${project.id}/requirements/approve`,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(resolvedFeedbackId, "feedback-1");
  });

  it("rejects approval when canonical requirements changed after session start", async () => {
    const { server, project } = createRouteFixture({
      getSession() {
        return {
          sessionId: "session-1",
          projectId: project.id,
          messages: [],
          status: "complete",
          kind: "requirements_revision",
          baseRequirementsRevision: requirementsRevision("# Original"),
          projectRevision: null,
          draftRequirements: "# Draft",
          startedAt: "2026-07-19T00:00:00.000Z",
          updatedAt: "2026-07-19T00:01:00.000Z",
        };
      },
    });
    writeRequirements(project.repoPath, "# Changed elsewhere");

    const response = await server.inject({
      method: "POST",
      url: `/api/queen-bee/${project.id}/requirements/approve`,
    });

    assert.equal(response.statusCode, 409);
    assert.equal(readRequirements(project.repoPath), "# Changed elsewhere");
  });

  it("routes approved card refinements through whole-board planning", async () => {
    const canonical = "# Requirements\n\nOriginal";
    const draft = "# Requirements\n\nRefined";
    let cardId = "";
    const { server, boardStore, project } = createRouteFixture({
      getCardSession() {
        return {
          sessionId: "session-card-1",
          projectId: project.id,
          cardId,
          messages: [
            {
              role: "assistant",
              content:
                'CARD_UPDATE\n```json\n{"description":"Refined card","acceptanceCriteria":["Works"],"relevantFiles":["source.ts"]}\n```',
            },
          ],
          status: "complete",
          kind: "requirements_repair",
          baseRequirementsRevision: requirementsRevision(canonical),
          projectRevision: null,
          draftRequirements: draft,
          startedAt: "2026-07-19T00:00:00.000Z",
          updatedAt: "2026-07-19T00:01:00.000Z",
        };
      },
    });
    writeRequirements(project.repoPath, canonical);
    const card = boardStore.addCard(project.id, project.repoPath, {
      title: "Idea",
      description: "Original card",
      acceptanceCriteria: ["Original"],
      relevantFiles: ["source.ts"],
      dependencies: [],
      column: "ready",
    });
    cardId = card.id;

    const response = await server.inject({
      method: "POST",
      url: `/api/queen-bee/${project.id}/cards/${card.id}/requirements/approve`,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().proposal.proposedRequirements, draft);
    assert.equal(readRequirements(project.repoPath), canonical);
    assert.equal(
      boardStore.getBoard(project.id, project.repoPath).cards[0]?.description,
      "Original card"
    );
  });

  function createRouteFixture(
    overrides: Partial<RequirementsSessionManager> = {},
    plannerOverrides: Partial<PlanningManager> = {}
  ) {
    const repoPath = mkdtempSync(join(tmpdir(), "hive-devise-routes-"));
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
    const engine: RequirementsSessionManager = {
      start: async () => ({ question: "Question" }),
      startRevision: async () => ({ question: "Question" }),
      startIdea: async () => ({ question: "Idea question" }),
      startRepair: async () => ({ question: "Repair question" }),
      respond: async () => ({ type: "question", question: "Question" }),
      respondIdea: async () => ({
        type: "question",
        question: "Idea question",
      }),
      getSession: () => undefined,
      getIdeaSession: () => undefined,
      startCard: async () => ({ question: "Card question" }),
      respondCard: async () => ({
        type: "question",
        question: "Card question",
      }),
      getCardSession: () => undefined,
      ...overrides,
    };
    const boardStore = createBoardStore(
      () => {},
      createQueenBeeRuntimeStore(join(repoPath, ".runtime"))
    );
    const planner: PlanningManager = {
      async propose(projectId, _repoPath, proposedRequirements) {
        return {
          id: "proposal-1",
          projectId,
          status: "pending",
          baseRequirementsRevision: requirementsRevision(
            readRequirements(repoPath)
          ),
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
      ...plannerOverrides,
    };
    const server = Fastify();
    servers.push(server);
    registerRequirementsRoutes(server, {
      sessionManager: engine,
      boardStore,
      projectStore,
      planningManager: planner,
    });
    return { server, boardStore, project };
  }
});
