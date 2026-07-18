/** @public */

import type { FastifyInstance, FastifyReply } from "fastify";
import type { WorkAttempt } from "shared/board-types";
import type { BoardStore, Card } from "./board-store";
import type { ProjectStore } from "./create-project-store";
import type { IntegrationManager } from "./integration-manager";

export function registerWorkDecisionRoutes(
  server: FastifyInstance,
  deps: {
    boardStore: BoardStore;
    projectStore: ProjectStore;
    integrationManager: IntegrationManager;
  }
): void {
  server.post(
    "/api/queen-bee/:projectId/cards/:cardId/accept",
    async (request, reply) => {
      const context = findReviewedCard(request.params, reply, deps);
      if (!context) return;
      const { projectId, project, card, attempt } = context;
      if (!attempt.reviewedHead || !attempt.reviewedIntegrationRevision) {
        return reply.status(409).send({
          error: "Reviewed Git revisions are missing; restart review",
        });
      }

      try {
        const integration = deps.integrationManager.accept({
          repoPath: project.repoPath,
          cardId: card.id,
          branchName: attempt.branchName,
          worktreePath: attempt.worktreePath,
          reviewedHead: attempt.reviewedHead,
          reviewedIntegrationRevision: attempt.reviewedIntegrationRevision,
        });
        const decidedAt = new Date().toISOString();
        const updated = deps.boardStore.updateCard(
          projectId,
          project.repoPath,
          card.id,
          {
            column: "done",
            workAttempts: updateAttempt(card, {
              status: "accepted",
              decision: { type: "accept", decidedAt },
            }),
          }
        );
        return reply.send({ card: updated, integration });
      } catch (error) {
        return reply.status(409).send({ error: errorMessage(error) });
      }
    }
  );

  server.post(
    "/api/queen-bee/:projectId/cards/:cardId/request-changes",
    async (request, reply) => {
      const body = request.body as { guidance?: string };
      const guidance = body.guidance?.trim();
      if (!guidance) {
        return reply.status(400).send({
          error: "guidance is required when requesting changes",
        });
      }
      const context = findDecisionCard(request.params, reply, deps);
      if (!context) return;
      const { projectId, project, card, attempt } = context;
      if (attempt.status !== "reviewed" && attempt.status !== "review_error") {
        return reply
          .status(409)
          .send({ error: "Card has no review to reject" });
      }

      try {
        deps.integrationManager.discardWorktree(
          project.repoPath,
          attempt.worktreePath
        );
        const decidedAt = new Date().toISOString();
        const updated = deps.boardStore.updateCard(
          projectId,
          project.repoPath,
          card.id,
          {
            column: "ready",
            workAttempts: updateAttempt(card, {
              status: "changes_requested",
              decision: {
                type: "request_changes",
                guidance,
                decidedAt,
              },
            }),
          }
        );
        return reply.send({ card: updated });
      } catch (error) {
        return reply.status(409).send({ error: errorMessage(error) });
      }
    }
  );
}

type DecisionContext = {
  projectId: string;
  project: ReturnType<ProjectStore["getAll"]>[number];
  card: Card;
  attempt: WorkAttempt;
};

function findReviewedCard(
  params: unknown,
  reply: FastifyReply,
  deps: {
    boardStore: BoardStore;
    projectStore: ProjectStore;
  }
): DecisionContext | null {
  const context = findDecisionCard(params, reply, deps);
  if (!context) return null;
  if (
    context.attempt.status !== "reviewed" ||
    context.card.reviewerLog?.status !== "complete" ||
    context.card.reviewerLog.reviewPackageId !== context.attempt.reviewPackageId
  ) {
    reply.status(409).send({
      error: "Card does not have a current completed review",
    });
    return null;
  }
  return context;
}

function findDecisionCard(
  params: unknown,
  reply: FastifyReply,
  deps: {
    boardStore: BoardStore;
    projectStore: ProjectStore;
  }
): DecisionContext | null {
  const { projectId, cardId } = params as {
    projectId: string;
    cardId: string;
  };
  const project = deps.projectStore
    .getAll()
    .find((candidate) => candidate.id === projectId);
  if (!project) {
    reply.status(404).send({ error: "Project not found" });
    return null;
  }
  const card = deps.boardStore
    .getBoard(projectId, project.repoPath)
    .cards.find((candidate) => candidate.id === cardId);
  if (!card) {
    reply.status(404).send({ error: "Card not found" });
    return null;
  }
  if (card.column !== "reviewing") {
    reply.status(409).send({ error: "Card is not awaiting a user decision" });
    return null;
  }
  const attempt = card.workAttempts?.at(-1);
  if (!attempt) {
    reply.status(409).send({ error: "Card has no recorded work attempt" });
    return null;
  }
  return { projectId, project, card, attempt };
}

function updateAttempt(card: Card, patch: Partial<WorkAttempt>): WorkAttempt[] {
  return (card.workAttempts ?? []).map((attempt, index, attempts) =>
    index === attempts.length - 1 ? { ...attempt, ...patch } : attempt
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Work decision failed";
}
