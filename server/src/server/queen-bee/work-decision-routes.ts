/** @public */

import type { FastifyInstance, FastifyReply } from "fastify";
import type { WorkAttempt } from "shared/board-types";
import type { BoardStore, Card } from "./board-store";
import type { ProjectStore } from "./create-project-store";
import type { IntegrationManager } from "./integration-manager";
import type { QueenBeeRuntimeStore } from "./queen-bee-runtime-store";
import { buildReviewPackage } from "./review-package";
import type { Reviewer, ReviewPackage } from "./reviewer";

export function registerWorkDecisionRoutes(
  server: FastifyInstance,
  deps: {
    boardStore: BoardStore;
    projectStore: ProjectStore;
    integrationManager: IntegrationManager;
    runtimeStore: QueenBeeRuntimeStore;
    reviewer: Reviewer;
    reviewPackageBuilder?: typeof buildReviewPackage;
  }
): void {
  server.get(
    "/api/queen-bee/:projectId/cards/:cardId/activity",
    async (request, reply) => {
      const card = findCard(request.params, reply, deps);
      if (!card) return;
      return reply.send({
        activity: deps.runtimeStore.getActivity(card.projectId, card.card.id),
      });
    }
  );

  server.get(
    "/api/queen-bee/:projectId/cards/:cardId/review-readiness",
    async (request, reply) => {
      const context = findDecisionCard(request.params, reply, deps);
      if (!context) return;
      const input = reviewedWorkInput(context);
      if (!input) {
        return reply.status(409).send({
          error: "Reviewed Git revisions are missing; restart the Worker Agent",
        });
      }
      try {
        return reply.send({
          readiness: deps.integrationManager.reviewReadiness(input),
        });
      } catch (error) {
        return reply.status(409).send({ error: errorMessage(error) });
      }
    }
  );

  server.post(
    "/api/queen-bee/:projectId/cards/:cardId/accept",
    async (request, reply) => {
      const context = findReviewedCard(request.params, reply, deps);
      if (!context) return;
      const { projectId, project, card } = context;
      const input = reviewedWorkInput(context);
      if (!input) {
        return reply.status(409).send({
          error: "Reviewed Git revisions are missing; restart review",
        });
      }

      try {
        const integration = deps.integrationManager.accept(input);
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
        deps.runtimeStore.appendActivity(projectId, card.id, {
          actor: "user",
          type: "decision",
          summary: "User accepted reviewed work into hive-main",
          detail: integration.revision,
        });
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
        deps.runtimeStore.appendActivity(projectId, card.id, {
          actor: "user",
          type: "decision",
          summary: "User requested another Worker Agent attempt",
          detail: guidance,
        });
        return reply.send({ card: updated });
      } catch (error) {
        return reply.status(409).send({ error: errorMessage(error) });
      }
    }
  );

  server.post(
    "/api/queen-bee/:projectId/cards/:cardId/restart-review",
    async (request, reply) => {
      const context = findDecisionCard(request.params, reply, deps);
      if (!context) return;
      const { projectId, project, card, attempt } = context;
      if (
        (attempt.status !== "review_error" && attempt.status !== "reviewed") ||
        !attempt.reviewPackageId
      ) {
        return reply.status(409).send({
          error: "Card does not have a review that can be restarted",
        });
      }
      const previousPackage = deps.runtimeStore.getReviewPackage(
        projectId,
        attempt.reviewPackageId
      );
      if (!previousPackage) {
        return reply.status(409).send({ error: "Review Package is missing" });
      }

      const input = reviewedWorkInput(context);
      if (!input) {
        return reply.status(409).send({
          error: "Reviewed Git revisions are missing; restart the Worker Agent",
        });
      }
      let reviewPackage = previousPackage;
      try {
        const readiness = deps.integrationManager.reviewReadiness(input);
        if (readiness.state === "stale" && readiness.canRefreshReview) {
          const builder = deps.reviewPackageBuilder ?? buildReviewPackage;
          reviewPackage = builder(
            card,
            project.repoPath,
            attempt.worktreePath,
            readiness.integrationRevision,
            completionFrom(previousPackage)
          );
          deps.runtimeStore.saveReviewPackage(projectId, reviewPackage);
        } else if (readiness.state !== "current") {
          return reply.status(409).send({
            error: readiness.message,
            readiness,
          });
        }
        deps.integrationManager.assertCurrent({
          ...input,
          reviewedHead: reviewPackage.revisions.headCommit,
          reviewedIntegrationRevision:
            reviewPackage.revisions.integrationCommit,
        });
        const verdict = await deps.reviewer.review(
          reviewPackage,
          attempt.worktreePath
        );
        const reviewedAt = new Date().toISOString();
        const updated = deps.boardStore.updateCard(
          projectId,
          project.repoPath,
          card.id,
          {
            reviewerLog: {
              status: "complete",
              verdict: verdict.verdict,
              findings: verdict.findings,
              verificationAssessment: verdict.verificationAssessment,
              reviewPackageId: reviewPackage.id,
              reviewedAt,
            },
            workAttempts: updateAttempt(card, {
              status: "reviewed",
              reviewedHead: reviewPackage.revisions.headCommit,
              reviewedIntegrationRevision:
                reviewPackage.revisions.integrationCommit,
              reviewPackageId: reviewPackage.id,
            }),
          }
        );
        deps.runtimeStore.appendActivity(projectId, card.id, {
          actor: "reviewer",
          type: "decision",
          summary:
            verdict.verdict === "approved"
              ? "Reviewer Agent approved the Review Package"
              : "Reviewer Agent requested changes",
          detail: JSON.stringify(verdict),
        });
        return reply.send({ card: updated });
      } catch (error) {
        const message = errorMessage(error);
        deps.boardStore.updateCard(projectId, project.repoPath, card.id, {
          reviewerLog: {
            status: "error",
            error: message,
            reviewPackageId: reviewPackage.id,
            reviewedAt: new Date().toISOString(),
          },
        });
        deps.runtimeStore.appendActivity(projectId, card.id, {
          actor: "reviewer",
          type: "error",
          summary: "Reviewer Agent retry failed",
          detail: message,
        });
        return reply.status(502).send({ error: message });
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
  const context = findCard(params, reply, deps);
  if (!context) return null;
  const { projectId, project, card } = context;
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

function findCard(
  params: unknown,
  reply: FastifyReply,
  deps: {
    boardStore: BoardStore;
    projectStore: ProjectStore;
  }
): Omit<DecisionContext, "attempt"> | null {
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
  return { projectId, project, card };
}

function updateAttempt(card: Card, patch: Partial<WorkAttempt>): WorkAttempt[] {
  return (card.workAttempts ?? []).map((attempt, index, attempts) =>
    index === attempts.length - 1 ? { ...attempt, ...patch } : attempt
  );
}

function reviewedWorkInput(
  context: DecisionContext
): Parameters<IntegrationManager["reviewReadiness"]>[0] | null {
  const { project, card, attempt } = context;
  if (!attempt.reviewedHead || !attempt.reviewedIntegrationRevision) {
    return null;
  }
  return {
    repoPath: project.repoPath,
    cardId: card.id,
    branchName: attempt.branchName,
    worktreePath: attempt.worktreePath,
    reviewedHead: attempt.reviewedHead,
    reviewedIntegrationRevision: attempt.reviewedIntegrationRevision,
  };
}

function completionFrom(
  reviewPackage: ReviewPackage
): Parameters<typeof buildReviewPackage>[4] {
  return {
    outcome: reviewPackage.noChangeRationale
      ? "already_satisfied"
      : "implemented",
    verificationCallIds: reviewPackage.verification.commands.map(
      (command) => command.callId
    ),
    verificationEvidence: reviewPackage.verification.commands,
    ...(reviewPackage.verification.notRunReason
      ? {
          verificationNotRunReason: reviewPackage.verification.notRunReason,
        }
      : {}),
    ...(reviewPackage.noChangeRationale
      ? { noChangeRationale: reviewPackage.noChangeRationale }
      : {}),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Work decision failed";
}
