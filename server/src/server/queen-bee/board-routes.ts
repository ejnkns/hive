/** @private — only imported by queen-bee.ts */

import type { FastifyInstance } from "fastify";
import type { PlanningOutcome } from "shared/board-types";
import type { BoardStore } from "./board-store";
import type { ProjectStore } from "./create-project-store";
import type { PlanningManager } from "./planner";
import { readRequirements } from "./requirements-store";

export function registerBoardRoutes(
  server: FastifyInstance,
  deps: {
    boardStore: BoardStore;
    planningManager: PlanningManager;
    projectStore: ProjectStore;
  }
): void {
  // Fastify derives every `request.params` object below from its static route
  // pattern; these casts bridge the untyped shared server instance.
  server.get("/api/queen-bee/:projectId/board", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = deps.projectStore.getAll().find((p) => p.id === projectId);
    if (!project) {
      return reply.status(404).send({ error: "Project not found" });
    }

    const board = deps.boardStore.getBoard(projectId, project.repoPath);
    return reply.send(board);
  });

  server.post("/api/queen-bee/:projectId/ideas", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = deps.projectStore.getAll().find((p) => p.id === projectId);
    if (!project) {
      return reply.status(404).send({ error: "Project not found" });
    }

    const body = isRecord(request.body) ? request.body : {};

    if (typeof body.title !== "string" || !body.title.trim()) {
      return reply.status(400).send({ error: "title is required" });
    }
    if (typeof body.brief !== "string" || !body.brief.trim()) {
      return reply.status(400).send({ error: "brief is required" });
    }

    const idea = deps.boardStore.addIdea(projectId, project.repoPath, {
      title: body.title.trim(),
      brief: body.brief.trim(),
    });

    return reply.status(201).send({ idea });
  });

  server.post(
    "/api/queen-bee/:projectId/ideas/:ideaId/archive",
    async (request, reply) => {
      const { projectId, ideaId } = request.params as {
        projectId: string;
        ideaId: string;
      };
      const project = deps.projectStore
        .getAll()
        .find((p) => p.id === projectId);
      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }

      try {
        const idea = deps.boardStore.archiveIdea(
          projectId,
          project.repoPath,
          ideaId
        );
        return reply.send({ idea });
      } catch {
        return reply.status(404).send({ error: "Idea not found" });
      }
    }
  );

  server.post("/api/queen-bee/:projectId/plan", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = deps.projectStore.getAll().find((p) => p.id === projectId);
    if (!project) {
      return reply.status(404).send({ error: "Project not found" });
    }

    try {
      const body = isRecord(request.body) ? request.body : {};
      const outcome = await deps.planningManager.propose(
        projectId,
        project.repoPath,
        readRequirements(project.repoPath),
        typeof body.guidance === "string" ? body.guidance : undefined
      );
      return reply.send(planningResponse(outcome));
    } catch (err) {
      return reply.status(500).send({
        error: err instanceof Error ? err.message : "Planning failed",
      });
    }
  });

  server.post(
    "/api/queen-bee/:projectId/planning/:proposalId/changes/:changeId",
    async (request, reply) => {
      const { projectId, proposalId, changeId } = request.params as {
        projectId: string;
        proposalId: string;
        changeId: string;
      };
      const body = isRecord(request.body) ? request.body : {};
      if (body.decision !== "accepted" && body.decision !== "rejected") {
        return reply.status(400).send({ error: "decision is invalid" });
      }
      try {
        const proposal = deps.planningManager.decide(
          projectId,
          proposalId,
          changeId,
          body.decision
        );
        return reply.send({ proposal });
      } catch (error) {
        return reply.status(409).send({
          error: error instanceof Error ? error.message : "Decision failed",
        });
      }
    }
  );

  server.post(
    "/api/queen-bee/:projectId/planning/:proposalId/accept-all",
    async (request, reply) => {
      const { projectId, proposalId } = request.params as {
        projectId: string;
        proposalId: string;
      };
      const project = deps.projectStore
        .getAll()
        .find((item) => item.id === projectId);
      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }
      try {
        const cards = deps.planningManager.acceptAll(
          projectId,
          project.repoPath,
          proposalId
        );
        return reply.send({ cards });
      } catch (error) {
        return reply.status(409).send({
          error: error instanceof Error ? error.message : "Planning failed",
        });
      }
    }
  );

  server.post(
    "/api/queen-bee/:projectId/planning/:proposalId/apply",
    async (request, reply) => {
      const { projectId, proposalId } = request.params as {
        projectId: string;
        proposalId: string;
      };
      const project = deps.projectStore
        .getAll()
        .find((item) => item.id === projectId);
      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }
      try {
        const cards = deps.planningManager.apply(
          projectId,
          project.repoPath,
          proposalId
        );
        return reply.send({ cards });
      } catch (error) {
        return reply.status(409).send({
          error: error instanceof Error ? error.message : "Planning failed",
        });
      }
    }
  );

  server.post(
    "/api/queen-bee/:projectId/planning/:proposalId/replan",
    async (request, reply) => {
      const { projectId, proposalId } = request.params as {
        projectId: string;
        proposalId: string;
      };
      const project = deps.projectStore
        .getAll()
        .find((item) => item.id === projectId);
      if (!project)
        return reply.status(404).send({ error: "Project not found" });
      const body = isRecord(request.body) ? request.body : {};
      if (typeof body.guidance !== "string" || !body.guidance.trim()) {
        return reply
          .status(400)
          .send({ error: "Planning Feedback is required" });
      }
      const previous = deps.planningManager.getProposal(projectId, proposalId);
      if (previous?.status !== "pending") {
        return reply
          .status(409)
          .send({ error: "Planning Proposal is not pending" });
      }
      try {
        const outcome = await deps.planningManager.propose(
          projectId,
          project.repoPath,
          previous.proposedRequirements,
          `User Planning Feedback:\n${body.guidance.trim()}`,
          { proposalId, target: "replanned" }
        );
        deps.planningManager.cancelProposal(projectId, proposalId);
        return reply.send(planningResponse(outcome));
      } catch (error) {
        return reply.status(500).send({
          error:
            error instanceof Error ? error.message : "Could not replan Cards",
        });
      }
    }
  );

  server.post(
    "/api/queen-bee/:projectId/planning/:proposalId/cancel",
    async (request, reply) => {
      const { projectId, proposalId } = request.params as {
        projectId: string;
        proposalId: string;
      };
      try {
        return reply.send({
          proposal: deps.planningManager.cancelProposal(projectId, proposalId),
        });
      } catch (error) {
        return reply.status(409).send({
          error:
            error instanceof Error
              ? error.message
              : "Could not cancel Planning Proposal",
        });
      }
    }
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function planningResponse(outcome: PlanningOutcome) {
  return "kind" in outcome ? { feedback: outcome } : { proposal: outcome };
}
