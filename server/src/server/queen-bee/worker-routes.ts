/** @private — only imported by queen-bee.ts */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { isRecord } from "shared/board-types";
import type { QueenBeeEvent } from "shared/queen-bee-events";
import type { BoardStore } from "./board-store";
import type { ProjectStore } from "./create-project-store";
import { evaluateWorkerAdmission } from "./worker-admission";
import { offQueenBeeEvent, onQueenBeeEvent } from "./worker-event-bus";
import type { WorkerEvent, WorkerSupervisor } from "./worker-supervisor";

export function registerWorkerRoutes(
  server: FastifyInstance,
  deps: {
    workerSupervisor: WorkerSupervisor;
    boardStore: BoardStore;
    projectStore: ProjectStore;
    onWorkerEvent?: (projectId: string, event: WorkerEvent) => void;
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

      if (card.column !== "ready") {
        return reply.status(400).send({
          error: "Card must be in the 'ready' column to run",
        });
      }
      if (deps.workerSupervisor.isRunning(projectId, cardId)) {
        return reply
          .status(409)
          .send({ error: "Worker Agent is already running" });
      }

      const body = isRecord(request.body) ? request.body : {};
      const admission = evaluateWorkerAdmission({
        card,
        cards: board.cards,
        runningCardIds: deps.workerSupervisor.runningCardIds(projectId),
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

      const projectJsonPath = join(project.repoPath, ".hive", "project.json");
      let systemPrompt = "";
      let codingGuidelines = "";

      try {
        const raw = readFileSync(projectJsonPath, "utf-8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        systemPrompt =
          typeof parsed.systemPrompt === "string" ? parsed.systemPrompt : "";
        codingGuidelines =
          typeof parsed.codingGuidelines === "string"
            ? parsed.codingGuidelines
            : "";
      } catch {
        // use empty defaults
      }

      reply.send({ started: true, cardId, admission });

      await deps.workerSupervisor.run(
        projectId,
        card,
        project.repoPath,
        systemPrompt,
        codingGuidelines,
        (event) => deps.onWorkerEvent?.(projectId, event)
      );
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

    // Send initial board snapshot for each project
    for (const project of deps.projectStore.getAll()) {
      try {
        const board = deps.boardStore.getBoard(project.id, project.repoPath);
        socket.send(
          JSON.stringify({
            type: "board_snapshot",
            version: 1,
            board,
          })
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

      const project = deps.projectStore
        .getAll()
        .find((p) => p.id === projectId);
      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }

      if (!deps.workerSupervisor.cancel(projectId, cardId)) {
        return reply.status(409).send({ error: "Worker Agent is not running" });
      }

      return reply.send({ cancelled: true, cardId });
    }
  );
}
