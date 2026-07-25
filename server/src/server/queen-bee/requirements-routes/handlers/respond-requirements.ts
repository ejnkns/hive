/** @private — only imported by register-routes.ts */

import type { FastifyReply, FastifyRequest } from "fastify";
import { isRecord } from "shared/board-types";
import type { RouteDeps } from "../types";

export function respondRequirementsHandler(deps: RouteDeps) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId } = request.params as { projectId: string };
    const body = isRecord(request.body) ? request.body : {};

    if (!body.answer || typeof body.answer !== "string") {
      return reply.status(400).send({ error: "answer is required" });
    }

    const project = deps.projectStore.getAll().find((p) => p.id === projectId);
    if (!project) {
      return reply.status(404).send({ error: "Project not found" });
    }

    try {
      const result = await deps.sessionManager.respond(
        projectId,
        body.answer,
        project.repoPath
      );

      if (result.type === "complete") {
        return reply.send({
          complete: true,
          spec: result.spec,
          draftRequirements: result.draftRequirements,
          projectId,
        });
      }

      return reply.send({
        question: result.question,
        draftRequirements: result.draftRequirements,
        projectId,
      });
    } catch (err) {
      return reply.status(500).send({
        error:
          err instanceof Error
            ? err.message
            : "Requirements Session response failed",
      });
    }
  };
}
