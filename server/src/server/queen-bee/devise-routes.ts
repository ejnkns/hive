/** @private — only imported by queen-bee.ts */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { ProjectStore } from "./create-project-store";
import type { DeviseEngine } from "./devise-engine";

export function registerDeviseRoutes(
  server: FastifyInstance,
  deps: { engine: DeviseEngine; projectStore: ProjectStore }
): void {
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
          const project = deps.projectStore
            .getAll()
            .find((p) => p.id === projectId);

          if (project) {
            const hiveDir = join(project.repoPath, ".hive");
            if (!existsSync(hiveDir)) {
              mkdirSync(hiveDir, { recursive: true });
            }
            writeFileSync(
              join(hiveDir, "requirements.md"),
              result.spec,
              "utf-8"
            );
          }

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
}
