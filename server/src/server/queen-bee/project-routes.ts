/** @private — only imported by queen-bee.ts */

import type { FastifyInstance } from "fastify";
import type { ProjectStore } from "./create-project-store";

export function registerProjectRoutes(
  server: FastifyInstance,
  store: ProjectStore
): void {
  server.get("/api/queen-bee/projects", async (_request, reply) => {
    return reply.send({ projects: store.getAll() });
  });

  server.post("/api/queen-bee/projects", async (request, reply) => {
    const body = request.body as { path?: string; name?: string };

    if (!body.path || typeof body.path !== "string") {
      return reply.status(400).send({ error: "path is required" });
    }

    try {
      const project = store.create(body.path, body.name);
      return reply.status(201).send({ project });
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : "Invalid project",
      });
    }
  });

  server.delete(
    "/api/queen-bee/projects/:projectId",
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };

      try {
        store.unlink(projectId);
        return reply.send({ ok: true });
      } catch (err) {
        return reply.status(404).send({
          error: err instanceof Error ? err.message : "Project not found",
        });
      }
    }
  );
}
