/** @private — only imported by register-routes.ts */

import type { FastifyReply, FastifyRequest } from "fastify";
import type { RouteDeps } from "../types";

export function resetSessionHandler(deps: RouteDeps) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId, sessionId } = request.params as {
      projectId: string;
      sessionId: string;
    };

    const project = deps.projectStore.getAll().find((p) => p.id === projectId);
    if (!project) {
      return reply.status(404).send({ error: "Project not found" });
    }

    try {
      await deps.sessionManager.resetSession(projectId, sessionId);
      return reply.send({ success: true });
    } catch (err) {
      if (err instanceof Error && err.message.includes("not found")) {
        return reply.status(404).send({ error: "Session not found" });
      }
      if (err instanceof Error && err.message.includes("submitted")) {
        return reply.status(409).send({ error: err.message });
      }
      return reply.status(500).send({
        error: err instanceof Error ? err.message : "Session reset failed",
      });
    }
  };
}
