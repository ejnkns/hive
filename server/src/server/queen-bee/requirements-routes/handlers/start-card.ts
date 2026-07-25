/** @private — only imported by register-routes.ts */

import type { FastifyReply, FastifyRequest } from "fastify";
import { isRecord } from "shared/board-types";
import type { RouteDeps } from "../types";

export function startCardHandler(deps: RouteDeps) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId, cardId } = request.params as {
      projectId: string;
      cardId: string;
    };
    const body = isRecord(request.body) ? request.body : {};

    if (!body.prompt || typeof body.prompt !== "string") {
      return reply.status(400).send({ error: "prompt is required" });
    }

    const project = deps.projectStore
      .getAll()
      .find((item) => item.id === projectId);
    if (!project) return reply.status(404).send({ error: "Project not found" });

    const card = deps.boardStore
      .getBoard(projectId, project.repoPath)
      .cards.find((item) => item.id === cardId);
    if (!card) return reply.status(404).send({ error: "Card not found" });

    try {
      const result = await deps.sessionManager.startCard(
        projectId,
        cardId,
        [
          "Repair the project requirements using the user's card-scoped concern without inspecting Board or Card content.",
          `User decision context: ${body.prompt}`,
          "Update only the complete project Requirements Draft. The Planner Agent will independently propose any Card changes after user approval.",
        ].join("\n"),
        project.repoPath
      );
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
            : "Card Requirements Session failed",
      });
    }
  };
}
