import type { FastifyInstance } from "fastify";
import type { Card } from "shared/board-types";
import { isRecord } from "shared/board-types";
import type { QueenBeeEvent } from "shared/queen-bee-events";
import { getFlowRuntime } from "../flow-registry";
import {
  getOrCreateInstance,
  runningCardIds,
} from "../workflow-instance-registry";
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
  }
): void {
  server.post(
    "/api/queen-bee/:projectId/cards/:cardId/run",
    async (request, reply) => {
      const { projectId, cardId } = request.params as {
        projectId: string;
        cardId: string;
      };

      const flow = getFlowRuntime(projectId);
      if (!flow) {
        return reply.status(404).send({ error: "Project not found" });
      }
      const config = flow.getFlowConfig() as Record<string, unknown>;
      const repoPath = (config.repoPath as string) ?? "";

      const board = deps.boardStore.getBoard(projectId, repoPath);
      const card = board.cards.find((c) => c.id === cardId);
      if (!card) {
        return reply.status(404).send({ error: "Card not found" });
      }

      const instance = getOrCreateInstance(projectId, cardId, repoPath);

      if (instance.getState().currentState !== "ready") {
        return reply.status(400).send({
          error: "Card must be in the 'ready' column to run",
        });
      }

      // File overlap check
      const blockers = fileOverlapBlockers(
        card,
        board.cards,
        new Set(runningCardIds(projectId))
      );
      if (blockers.length > 0) {
        const body = isRecord(request.body) ? request.body : {};
        if (body.confirmRisks !== true) {
          return reply.status(409).send({
            error:
              "File overlap with active cards requires explicit confirmation",
            blockers,
          });
        }
      }

      instance.dispatchAction("run");

      if (instance.getState().currentState !== "in_progress") {
        return reply.status(409).send({
          error:
            "Cannot start worker: action unavailable or concurrency limit reached",
        });
      }

      reply.send({ started: true, cardId });
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

      const instance = getOrCreateInstance(projectId, cardId, "");
      if (!instance.getState().hasRunningTask) {
        return reply.status(409).send({ error: "Worker Agent is not running" });
      }

      instance.cancel();
      return reply.send({ cancelled: true, cardId });
    }
  );
}

function fileOverlapBlockers(
  card: Card,
  cards: Card[],
  runningCardIds: Set<string>
): Array<{
  kind: string;
  message: string;
  cardIds: string[];
  files: string[];
}> {
  const targetFiles = new Set(card.relevantFiles.map(normalizeFile));
  const blockers: Array<{
    kind: string;
    message: string;
    cardIds: string[];
    files: string[];
  }> = [];
  for (const activeCard of cards) {
    if (!runningCardIds.has(activeCard.id) || activeCard.id === card.id) {
      continue;
    }
    const files = activeCard.relevantFiles
      .map(normalizeFile)
      .filter((file) => targetFiles.has(file));
    if (files.length === 0) continue;
    blockers.push({
      kind: "file_overlap",
      message: `Active card '${activeCard.title}' shares relevant files with this work`,
      cardIds: [activeCard.id],
      files: [...new Set(files)].sort(),
    });
  }
  return blockers;
}

function normalizeFile(file: string): string {
  return file.replaceAll("\\", "/").replace(/^\.\//, "");
}
