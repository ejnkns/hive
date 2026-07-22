/** @private — only imported by queen-bee.ts */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { QueenBeeEvent } from "shared/queen-bee-events";
import type { BoardStore } from "./board-store";
import type { ProjectStore } from "./create-project-store";
import type { RequirementsDraftUpdate } from "./devise-engine";
import { evaluateWorkerAdmission } from "./worker-admission";
import {
  boardEventBus,
  offQueenBeeEvent,
  onQueenBeeEvent,
  projectEventBus,
  requirementsEventBus,
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
        (event) => deps.onWorkerEvent(projectId, event)
      );
    }
  );

  server.get("/api/queen-bee/ws", { websocket: true }, (socket) => {
    const workerHandler = (event: WorkerEvent, projectId: string) => {
      try {
        socket.send(JSON.stringify(toWorkerSocketMessage(event, projectId)));
      } catch {
        // socket closed
      }
    };

    const boardHandler = (projectId: string) => {
      try {
        const project = deps.projectStore
          .getAll()
          .find((candidate) => candidate.id === projectId);
        if (!project) return;
        socket.send(
          JSON.stringify(
            toBoardSocketMessage(
              projectId,
              deps.boardStore.getBoard(projectId, project.repoPath)
            )
          )
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

    function requirementsHandler(update: RequirementsDraftUpdate): void {
      try {
        socket.send(
          JSON.stringify({ type: "requirements_draft_updated", data: update })
        );
      } catch {
        // socket closed
      }
    }

    workerEventBus.on("event", workerHandler);
    boardEventBus.on("change", boardHandler);
    projectEventBus.on("change", projectHandler);
    requirementsEventBus.on("draft", requirementsHandler);

    const queenBeeHandler = (event: QueenBeeEvent) => {
      try {
        socket.send(JSON.stringify(event));
      } catch {
        // socket closed
      }
    };
    onQueenBeeEvent(queenBeeHandler);

    socket.on("close", () => {
      workerEventBus.off("event", workerHandler);
      boardEventBus.off("change", boardHandler);
      projectEventBus.off("change", projectHandler);
      requirementsEventBus.off("draft", requirementsHandler);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toWorkerSocketMessage(
  event: WorkerEvent,
  projectId: string
): {
  type: string;
  data: Record<string, unknown>;
} {
  if (event.type === "worker_complete") {
    return {
      type: "worker_complete",
      data: {
        projectId,
        cardId: event.cardId,
        content: event.content ?? "",
      },
    };
  }
  if (event.type === "unfulfillable_handover") {
    return {
      type: "unfulfillable_handover",
      data: {
        projectId,
        cardId: event.cardId,
        content: event.content ?? "",
        suggestions: event.suggestions ?? [],
        error: event.error ?? null,
      },
    };
  }
  return {
    type: "worker_progress",
    data: {
      projectId,
      cardId: event.cardId,
      content: event.content ?? "",
      toolName: event.toolName ?? null,
      error: event.error ?? null,
    },
  };
}

export function toBoardSocketMessage(
  projectId: string,
  board: ReturnType<BoardStore["getBoard"]>
): {
  type: "board_updated";
  data: { projectId: string; board: ReturnType<BoardStore["getBoard"]> };
} {
  return { type: "board_updated", data: { projectId, board } };
}
