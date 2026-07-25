/** @private — only imported by register-routes.ts */

import type { FastifyReply, FastifyRequest } from "fastify";
import { isRecord } from "shared/board-types";
import type { RouteDeps } from "../types";

export function respondCardHandler(deps: RouteDeps) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId, cardId } = request.params as {
      projectId: string;
      cardId: string;
    };
    const body = isRecord(request.body) ? request.body : {};

    if (!body.answer || typeof body.answer !== "string") {
      return reply.status(400).send({ error: "answer is required" });
    }

    const project = deps.projectStore
      .getAll()
      .find((item) => item.id === projectId);
    if (!project) return reply.status(404).send({ error: "Project not found" });

    try {
      const result = await deps.sessionManager.respondCard(
        projectId,
        cardId,
        body.answer,
        project.repoPath
      );
      if (result.type === "complete") {
        if (!result.draftRequirements.trim()) {
          return reply.status(422).send({
            error:
              "Card requirements session completed without an aligned requirements draft",
          });
        }
        return reply.send({
          complete: true,
          spec: result.spec,
          draftRequirements: result.draftRequirements,
          projectId,
          cardId,
        });
      }
      return reply.send({
        question: result.question,
        draftRequirements: result.draftRequirements,
        projectId,
        cardId,
      });
    } catch (err) {
      return reply.status(500).send({
        error:
          err instanceof Error
            ? err.message
            : "Card Requirements Session response failed",
      });
    }
  };
}
