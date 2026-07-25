/** @private — only imported by register-routes.ts */

import type { FastifyReply, FastifyRequest } from "fastify";
import type { RouteDeps } from "../types";

export function getIdeaSessionHandler(deps: RouteDeps) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId, ideaId } = request.params as {
      projectId: string;
      ideaId: string;
    };

    const session = deps.sessionManager.getIdeaSession(projectId, ideaId);
    if (!session) return reply.send({ active: false });
    if (session.status === "submitted") {
      return reply.send({ active: false, status: session.status });
    }
    return reply.send({
      active: true,
      status: session.status,
      kind: session.kind,
      question: session.messages
        .filter((message) => message.role === "assistant")
        .at(-1)?.content,
      draftRequirements: session.draftRequirements,
    });
  };
}
