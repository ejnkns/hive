/** @private — only imported by register-routes.ts */

import type { FastifyReply, FastifyRequest } from "fastify";
import { isRecord } from "shared/board-types";
import type { RouteDeps } from "../types";

export function startRequirementsHandler(deps: RouteDeps) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId } = request.params as { projectId: string };
    const body = isRecord(request.body) ? request.body : {};

    if (!body.prompt || typeof body.prompt !== "string") {
      return reply.status(400).send({ error: "prompt is required" });
    }

    const project = deps.projectStore.getAll().find((p) => p.id === projectId);
    if (!project) {
      return reply.status(404).send({ error: "Project not found" });
    }

    try {
      const result = await deps.sessionManager.start(
        projectId,
        body.prompt,
        project.repoPath
      );
      return reply.send({
        sessionId: result.sessionId,
        question: result.question,
        draftRequirements: result.draftRequirements,
        projectId,
      });
    } catch (err) {
      return reply.status(500).send({
        error:
          err instanceof Error ? err.message : "Requirements Session failed",
      });
    }
  };
}
