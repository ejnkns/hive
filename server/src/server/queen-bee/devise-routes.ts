/** @private — only imported by queen-bee.ts */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { BoardStore } from "./board-store";
import type { ProjectStore } from "./create-project-store";
import type { DeviseEngine } from "./devise-engine";

export function registerDeviseRoutes(
  server: FastifyInstance,
  deps: {
    engine: DeviseEngine;
    projectStore: ProjectStore;
    boardStore: BoardStore;
  }
): void {
  server.post(
    "/api/queen-bee/:projectId/devise/redevise/start",
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const body = request.body as { prompt?: string; confirmActive?: boolean };
      if (!body.prompt || typeof body.prompt !== "string") {
        return reply.status(400).send({ error: "prompt is required" });
      }

      const project = deps.projectStore
        .getAll()
        .find((item) => item.id === projectId);
      if (!project)
        return reply.status(404).send({ error: "Project not found" });

      const activeCards = deps.boardStore
        .getBoard(projectId, project.repoPath)
        .cards.filter(
          (card) => card.column === "in_progress" || card.column === "reviewing"
        );
      if (activeCards.length > 0 && !body.confirmActive) {
        return reply.status(409).send({
          error: "Active work may no longer match regenerated requirements",
          requiresConfirmation: true,
          activeCardIds: activeCards.map((card) => card.id),
        });
      }

      try {
        const result = await deps.engine.start(
          projectId,
          `Re-devise the project requirements before regenerating the board. Preserve confirmed scope unless the user explicitly changes it.\n\nUser context: ${body.prompt}`,
          project.repoPath
        );
        return reply.send({
          question: result.question,
          projectId,
          redevise: true,
        });
      } catch (err) {
        return reply.status(500).send({
          error:
            err instanceof Error ? err.message : "Re-devise session failed",
        });
      }
    }
  );

  server.post(
    "/api/queen-bee/:projectId/cards/:cardId/devise/start",
    async (request, reply) => {
      const { projectId, cardId } = request.params as {
        projectId: string;
        cardId: string;
      };
      const body = request.body as { prompt?: string };
      if (!body.prompt || typeof body.prompt !== "string") {
        return reply.status(400).send({ error: "prompt is required" });
      }
      const project = deps.projectStore
        .getAll()
        .find((item) => item.id === projectId);
      if (!project)
        return reply.status(404).send({ error: "Project not found" });
      const card = deps.boardStore
        .getBoard(projectId, project.repoPath)
        .cards.find((item) => item.id === cardId);
      if (!card) return reply.status(404).send({ error: "Card not found" });

      try {
        const result = await deps.engine.startCard(
          projectId,
          cardId,
          [
            "Refine this one card while keeping the project requirements document aligned.",
            `Card title: ${card.title}`,
            `Current card description: ${card.description}`,
            `User context: ${body.prompt}`,
          ].join("\n"),
          project.repoPath
        );
        return reply.send({ question: result.question, projectId, cardId });
      } catch (err) {
        return reply.status(500).send({
          error:
            err instanceof Error ? err.message : "Card devise session failed",
        });
      }
    }
  );

  server.post(
    "/api/queen-bee/:projectId/cards/:cardId/devise/respond",
    async (request, reply) => {
      const { projectId, cardId } = request.params as {
        projectId: string;
        cardId: string;
      };
      const body = request.body as { answer?: string };
      if (!body.answer || typeof body.answer !== "string") {
        return reply.status(400).send({ error: "answer is required" });
      }
      const project = deps.projectStore
        .getAll()
        .find((item) => item.id === projectId);
      if (!project)
        return reply.status(404).send({ error: "Project not found" });

      try {
        const result = await deps.engine.respondCard(
          projectId,
          cardId,
          body.answer,
          project.repoPath
        );
        if (result.type === "complete") {
          return reply.send({
            complete: true,
            spec: result.spec,
            projectId,
            cardId,
          });
        }
        return reply.send({ question: result.question, projectId, cardId });
      } catch (err) {
        return reply.status(500).send({
          error:
            err instanceof Error ? err.message : "Card devise response failed",
        });
      }
    }
  );

  server.post(
    "/api/queen-bee/:projectId/devise/start",
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const body = request.body as { prompt?: string };

      if (!body.prompt || typeof body.prompt !== "string") {
        return reply.status(400).send({ error: "prompt is required" });
      }

      const project = deps.projectStore
        .getAll()
        .find((p) => p.id === projectId);
      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }

      try {
        const result = await deps.engine.start(
          projectId,
          body.prompt,
          project.repoPath
        );
        return reply.send({ question: result.question, projectId });
      } catch (err) {
        return reply.status(500).send({
          error: err instanceof Error ? err.message : "Devise session failed",
        });
      }
    }
  );

  server.post(
    "/api/queen-bee/:projectId/devise/respond",
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const body = request.body as { answer?: string };

      if (!body.answer || typeof body.answer !== "string") {
        return reply.status(400).send({ error: "answer is required" });
      }

      const project = deps.projectStore
        .getAll()
        .find((p) => p.id === projectId);
      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }

      try {
        const result = await deps.engine.respond(
          projectId,
          body.answer,
          project.repoPath
        );

        if (result.type === "complete") {
          return reply.send({ complete: true, spec: result.spec, projectId });
        }

        return reply.send({ question: result.question, projectId });
      } catch (err) {
        return reply.status(500).send({
          error: err instanceof Error ? err.message : "Devise response failed",
        });
      }
    }
  );

  server.get(
    "/api/queen-bee/:projectId/devise/status",
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };

      const project = deps.projectStore
        .getAll()
        .find((p) => p.id === projectId);
      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }

      const requirementsPath = join(
        project.repoPath,
        ".hive",
        "requirements.md"
      );
      const hasRequirements = existsSync(requirementsPath);

      return reply.send({ projectId, hasRequirements });
    }
  );

  server.get(
    "/api/queen-bee/:projectId/requirements",
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };

      const project = deps.projectStore
        .getAll()
        .find((p) => p.id === projectId);
      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }

      const requirementsPath = join(
        project.repoPath,
        ".hive",
        "requirements.md"
      );

      try {
        const content = readFileSync(requirementsPath, "utf-8");
        return reply.send({ content });
      } catch {
        return reply.status(404).send({ error: "Requirements not found" });
      }
    }
  );

  server.get(
    "/api/queen-bee/:projectId/devise/session",
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const session = deps.engine.getSession(projectId);

      if (!session) {
        return reply.send({ active: false });
      }

      const clientMessages = session.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role,
          content: m.content,
        }));

      return reply.send({
        active: true,
        status: session.status,
        messages: clientMessages,
      });
    }
  );
}
