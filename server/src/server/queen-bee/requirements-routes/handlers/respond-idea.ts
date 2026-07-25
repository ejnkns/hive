/** @private — only imported by register-routes.ts */

import type { FastifyReply, FastifyRequest } from "fastify";
import { isRecord } from "shared/board-types";
import type { RouteDeps } from "../types";

export function respondIdeaHandler(deps: RouteDeps) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId, ideaId } = request.params as {
      projectId: string;
      ideaId: string;
    };

    const project = deps.projectStore
      .getAll()
      .find((item) => item.id === projectId);
    if (!project) return reply.status(404).send({ error: "Project not found" });

    const body = isRecord(request.body) ? request.body : {};
    if (typeof body.answer !== "string" || !body.answer.trim()) {
      return reply.status(400).send({ error: "answer is required" });
    }

    try {
      const result = await deps.sessionManager.respondIdea(
        projectId,
        ideaId,
        body.answer.trim(),
        project.repoPath
      );
      return reply.send({ ...result, complete: result.type === "complete" });
    } catch (error) {
      return reply.status(409).send({
        error:
          error instanceof Error ? error.message : "Idea elaboration failed",
      });
    }
  };
}
