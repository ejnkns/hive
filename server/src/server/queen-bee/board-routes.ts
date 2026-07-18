/** @private — only imported by queen-bee.ts */

import type { FastifyInstance } from "fastify";
import type { BoardStore, Column } from "./board-store";
import type { ProjectStore } from "./create-project-store";
import type { Planner } from "./planner";

export function registerBoardRoutes(
  server: FastifyInstance,
  deps: { boardStore: BoardStore; planner: Planner; projectStore: ProjectStore }
): void {
  server.get("/api/queen-bee/:projectId/board", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = deps.projectStore.getAll().find((p) => p.id === projectId);
    if (!project) {
      return reply.status(404).send({ error: "Project not found" });
    }

    const board = deps.boardStore.getBoard(projectId, project.repoPath);
    return reply.send(board);
  });

  server.post("/api/queen-bee/:projectId/cards", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = deps.projectStore.getAll().find((p) => p.id === projectId);
    if (!project) {
      return reply.status(404).send({ error: "Project not found" });
    }

    const body = request.body as {
      title?: string;
      description?: string;
      acceptanceCriteria?: string[];
      relevantFiles?: string[];
      dependencies?: string[];
      column?: string;
    };

    if (!body.title || typeof body.title !== "string") {
      return reply.status(400).send({ error: "title is required" });
    }

    const column = validateColumn(body.column);

    const card = deps.boardStore.addCard(projectId, project.repoPath, {
      title: body.title,
      description: body.description ?? "",
      acceptanceCriteria: body.acceptanceCriteria ?? [],
      relevantFiles: body.relevantFiles ?? [],
      dependencies: body.dependencies ?? [],
      column,
    });

    return reply.status(201).send({ card });
  });

  server.patch(
    "/api/queen-bee/:projectId/cards/:cardId",
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

      const body = request.body as { column?: string };

      if (!body.column || typeof body.column !== "string") {
        return reply.status(400).send({ error: "column is required" });
      }

      const column = validateColumn(body.column);

      try {
        const board = deps.boardStore.getBoard(projectId, project.repoPath);
        const existing = board.cards.find((c) => c.id === cardId);
        if (!existing) {
          return reply.status(404).send({ error: "Card not found" });
        }

        if (
          existing.column === "idea" &&
          column === "ready" &&
          (!existing.description ||
            !existing.acceptanceCriteria ||
            existing.acceptanceCriteria.length === 0)
        ) {
          return reply.status(400).send({
            error:
              "Card must have a description and at least one acceptance criterion before moving to 'ready'",
          });
        }

        const moved = deps.boardStore.moveCard(
          projectId,
          project.repoPath,
          cardId,
          column
        );
        return reply.send({ card: moved });
      } catch {
        return reply.status(404).send({ error: "Card not found" });
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
      const body = (request.body ?? {}) as { guidance?: string };
      const cards = await deps.planner.plan(
        projectId,
        project.repoPath,
        body.guidance
      );
      return reply.send({ cards });
    } catch (err) {
      return reply.status(500).send({
        error: err instanceof Error ? err.message : "Planning failed",
      });
    }
  });
}

function validateColumn(column: string | undefined): Column {
  if (
    column &&
    [
      "idea",
      "ready",
      "in_progress",
      "reviewing",
      "done",
      "unfulfillable",
    ].includes(column)
  ) {
    return column as Column;
  }
  return "idea";
}
