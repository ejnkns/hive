/** @private — only imported by queen-bee.ts */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { BoardStore } from "./board-store";
import type { ProjectStore } from "./create-project-store";
import {
  boardEventBus,
  projectEventBus,
  workerEventBus,
} from "./worker-event-bus";
import type { WorkerEvent, WorkerSupervisor } from "./worker-supervisor";

export function registerWorkerRoutes(
  server: FastifyInstance,
  deps: {
    workerSupervisor: WorkerSupervisor;
    boardStore: BoardStore;
    projectStore: ProjectStore;
    onWorkerEvent: (projectId: string, event: WorkerEvent) => void;
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

      if (card.column !== "ready" && card.column !== "in_progress") {
        return reply.status(400).send({
          error: "Card must be in 'ready' or 'in_progress' column to run",
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

      reply.send({ started: true, cardId });

      await deps.workerSupervisor.run(
        card,
        project.repoPath,
        systemPrompt,
        codingGuidelines,
        (event) => deps.onWorkerEvent(projectId, event)
      );
    }
  );

  server.get("/api/queen-bee/ws", { websocket: true }, (socket) => {
    const workerHandler = (event: WorkerEvent, projectId: string) => {
      try {
        socket.send(
          JSON.stringify({
            type: "worker_event",
            data: { projectId, ...event },
          })
        );
      } catch {
        // socket closed
      }
    };

    const boardHandler = (projectId: string) => {
      try {
        socket.send(
          JSON.stringify({ type: "board_updated", data: { projectId } })
        );
      } catch {
        // socket closed
      }
    };

    const projectHandler = () => {
      try {
        socket.send(JSON.stringify({ type: "projects_changed" }));
      } catch {
        // socket closed
      }
    };

    workerEventBus.on("event", workerHandler);
    boardEventBus.on("change", boardHandler);
    projectEventBus.on("change", projectHandler);

    socket.on("close", () => {
      workerEventBus.off("event", workerHandler);
      boardEventBus.off("change", boardHandler);
      projectEventBus.off("change", projectHandler);
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

      deps.workerSupervisor.cancel(cardId);

      return reply.send({ cancelled: true, cardId });
    }
  );
}
