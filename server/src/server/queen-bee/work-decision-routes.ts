/** @public */

import type { FastifyInstance, FastifyReply } from "fastify";
import { getOrCreateOrchestrator } from "../orchestrator-registry";
import type { BoardStore, Card } from "./board-store";
import type { ProjectStore } from "./create-project-store";
import type { IntegrationManager } from "./integration-manager";
import type { QueenBeeRuntimeStore } from "./queen-bee-runtime-store";
import { emitCardAccepted } from "./worker-event-bus";

export function registerWorkDecisionRoutes(
  server: FastifyInstance,
  deps: {
    boardStore: BoardStore;
    projectStore: ProjectStore;
    integrationManager: IntegrationManager;
    runtimeStore: QueenBeeRuntimeStore;
    reviewer: unknown;
    workspacesBasePath: string;
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
        const orchestrator = getOrCreateOrchestrator(
          project.id,
          card.id,
          project.repoPath
        );
        orchestrator.dispatchAction("update_changes");
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
        const orchestrator = getOrCreateOrchestrator(
          project.id,
          card.id,
          project.repoPath
        );
        orchestrator.dispatchAction("new_changes");
        return reply.send({ action: "new_changes", cardId: card.id });
      });
    }
  );

  server.post(
    "/api/queen-bee/:projectId/cards/:cardId/restart-review",
    async (request, reply) => {
      const params = request.params as { projectId: string; cardId: string };
      return withCard(params, deps, reply, async (card, project) => {
        const orchestrator = getOrCreateOrchestrator(
          project.id,
          card.id,
          project.repoPath
        );
        orchestrator.dispatchAction("restart_review");
        return reply.send({ action: "restart_review", cardId: card.id });
      });
    }
  );
}

// ── helpers ──────────────────────────────────────────────────────

async function withCard(
  params: { projectId: string; cardId: string },
  deps: { boardStore: BoardStore; projectStore: ProjectStore },
  reply: FastifyReply,
  handler: (
    card: Card,
    project: { id: string; repoPath: string }
  ) => Promise<FastifyReply>
): Promise<FastifyReply> {
  const project = deps.projectStore
    .getAll()
    .find((p) => p.id === params.projectId);
  if (!project) return reply.status(404).send({ error: "Project not found" });

  const board = deps.boardStore.getBoard(params.projectId, project.repoPath);
  const card = board.cards.find((c) => c.id === params.cardId);
  if (!card) return reply.status(404).send({ error: "Card not found" });

  return handler(card, project);
}
