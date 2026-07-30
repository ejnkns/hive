/** @public */

import type { FastifyInstance, FastifyReply } from "fastify";
import type { Card } from "shared/board-types";
import { getFlowRuntime } from "../flow-registry";
import { getOrCreateInstance } from "../workflow-instance-registry";
import { emitCardAccepted } from "./worker-event-bus";

type BoardStore = {
  getBoard(
    projectId: string,
    repoPath: string
  ): { projectId: string; cards: Card[]; ideas: unknown[] };
  moveCard(
    projectId: string,
    repoPath: string,
    cardId: string,
    column: string
  ): Card;
};

export function registerWorkDecisionRoutes(
  server: FastifyInstance,
  deps: {
    boardStore: BoardStore;
  }
): void {
  // ── accept ──────────────────────────────────────────────────────

  server.post(
    "/api/queen-bee/:projectId/cards/:cardId/accept",
    async (request, reply) => {
      const params = request.params as { projectId: string; cardId: string };
      return withCard(params, deps, reply, async (card, project) => {
        deps.boardStore.moveCard(project.id, project.repoPath, card.id, "done");
        emitCardAccepted(card.id);
        return reply.send({ accepted: true, cardId: card.id });
      });
    }
  );

  server.post(
    "/api/queen-bee/:projectId/cards/:cardId/accept-anyway",
    async (request, reply) => {
      const params = request.params as { projectId: string; cardId: string };
      return withCard(params, deps, reply, async (card, project) => {
        deps.boardStore.moveCard(project.id, project.repoPath, card.id, "done");
        emitCardAccepted(card.id);
        return reply.send({ accepted: true, cardId: card.id });
      });
    }
  );

  server.post(
    "/api/queen-bee/:projectId/cards/:cardId/update-changes",
    async (request, reply) => {
      const params = request.params as { projectId: string; cardId: string };
      return withCard(params, deps, reply, async (card, project) => {
        deps.boardStore.moveCard(
          project.id,
          project.repoPath,
          card.id,
          "in_progress"
        );
        const instance = getOrCreateInstance(
          project.id,
          card.id,
          project.repoPath
        );
        instance.dispatchAction("update_changes");
        return reply.send({ action: "update_changes", cardId: card.id });
      });
    }
  );

  server.post(
    "/api/queen-bee/:projectId/cards/:cardId/new-changes",
    async (request, reply) => {
      const params = request.params as { projectId: string; cardId: string };
      return withCard(params, deps, reply, async (card, project) => {
        deps.boardStore.moveCard(
          project.id,
          project.repoPath,
          card.id,
          "ready"
        );
        const instance = getOrCreateInstance(
          project.id,
          card.id,
          project.repoPath
        );
        instance.dispatchAction("new_changes");
        return reply.send({ action: "new_changes", cardId: card.id });
      });
    }
  );

  server.post(
    "/api/queen-bee/:projectId/cards/:cardId/restart-review",
    async (request, reply) => {
      const params = request.params as { projectId: string; cardId: string };
      return withCard(params, deps, reply, async (card, project) => {
        const instance = getOrCreateInstance(
          project.id,
          card.id,
          project.repoPath
        );
        instance.dispatchAction("restart_review");
        return reply.send({ action: "restart_review", cardId: card.id });
      });
    }
  );
}

// ── helpers ──────────────────────────────────────────────────────

async function withCard(
  params: { projectId: string; cardId: string },
  deps: { boardStore: BoardStore },
  reply: FastifyReply,
  handler: (
    card: Card,
    project: { id: string; repoPath: string }
  ) => Promise<FastifyReply>
): Promise<FastifyReply> {
  const runtime = getFlowRuntime(params.projectId);
  if (!runtime) return reply.status(404).send({ error: "Project not found" });

  const config = runtime.getFlowConfig() as Record<string, unknown>;
  const repoPath = (config.repoPath as string) ?? "";
  if (!repoPath) return reply.status(404).send({ error: "Project not found" });

  const board = deps.boardStore.getBoard(params.projectId, repoPath);
  const card = board.cards.find((c) => c.id === params.cardId);
  if (!card) return reply.status(404).send({ error: "Card not found" });

  return handler(card, { id: params.projectId, repoPath });
}
