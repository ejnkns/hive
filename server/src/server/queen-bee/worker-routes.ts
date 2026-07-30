import type { FastifyInstance } from "fastify";
import type { Card } from "shared/board-types";
import { isRecord } from "shared/board-types";
import type { QueenBeeEvent } from "shared/queen-bee-events";
import {
  getOrCreateOrchestrator,
  runningCardIds,
} from "../orchestrator-registry";
import type { ProjectStore } from "./create-project-store";
import { evaluateWorkerAdmission } from "./worker-admission";
import { offQueenBeeEvent, onQueenBeeEvent } from "./worker-event-bus";

type Board = {
  projectId: string;
  cards: Card[];
  ideas: unknown[];
};

type BoardStore = {
  getBoard(projectId: string, repoPath: string): Board;
};

export function registerWorkerRoutes(
  server: FastifyInstance,
  deps: {
    boardStore: BoardStore;
    projectStore: ProjectStore;
  }
): void {
  server.post(
    "/api/queen-bee/:projectId/cards/:cardId/run",
    async (request, reply) => {
      const { projectId, cardId } = request.params as {
        projectId: string;
        cardId: string;
      };

      const project = deps.projectStore
        .getAll()
        .find((p) => p.id === projectId);
      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }

      const board = deps.boardStore.getBoard(projectId, project.repoPath);
      const card = board.cards.find((c) => c.id === cardId);
      if (!card) {
        return reply.status(404).send({ error: "Card not found" });
      }

      const orchestrator = getOrCreateOrchestrator(
        projectId,
        cardId,
        project.repoPath
      );

      if (orchestrator.getState().currentState !== "ready") {
        return reply.status(400).send({
          error: "Card must be in the 'ready' column to run",
        });
      }
      if (orchestrator.getState().hasRunningTask) {
        return reply
          .status(409)
          .send({ error: "Worker Agent is already running" });
      }

      const body = isRecord(request.body) ? request.body : {};
      const admission = evaluateWorkerAdmission({
        card,
        cards: board.cards,
        runningCardIds: runningCardIds(projectId),
        maxConcurrentWorkers: project.maxConcurrentWorkers,
        confirmRisks: body.confirmRisks === true,
      });
      if (!admission.allowed) {
        return reply.status(409).send({
          error: admission.canOverride
            ? "Worker start requires explicit risk confirmation"
            : "Project worker capacity has been reached",
          admission,
        });
      }

      orchestrator.dispatchAction("run");
      reply.send({ started: true, cardId, admission });
    }
  );

  server.get("/api/queen-bee/ws", { websocket: true }, (socket) => {
    const queenBeeHandler = (event: QueenBeeEvent) => {
      try {
        socket.send(JSON.stringify(event));
      } catch {
        // socket closed
      }
    };
    onQueenBeeEvent(queenBeeHandler);

    for (const project of deps.projectStore.getAll()) {
      try {
        const board = deps.boardStore.getBoard(project.id, project.repoPath);
        socket.send(
          JSON.stringify({ type: "board_snapshot", version: 1, board })
        );
      } catch {
        // project not ready, skip
      }
    }

    socket.on("close", () => {
      offQueenBeeEvent(queenBeeHandler);
    });
  });

  server.post(
    "/api/queen-bee/:projectId/cards/:cardId/cancel",
    async (request, reply) => {
      const { projectId, cardId } = request.params as {
        projectId: string;
        cardId: string;
      };

      const orchestrator = getOrCreateOrchestrator(projectId, cardId, "");
      if (!orchestrator.getState().hasRunningTask) {
        return reply.status(409).send({ error: "Worker Agent is not running" });
      }

      orchestrator.cancel();
      return reply.send({ cancelled: true, cardId });
    }
  );
}
