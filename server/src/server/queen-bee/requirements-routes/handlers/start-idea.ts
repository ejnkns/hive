/** @private — only imported by register-routes.ts */

import type { FastifyReply, FastifyRequest } from "fastify";
import { isRecord } from "shared/board-types";
import type { RouteDeps } from "../types";

export function startIdeaHandler(deps: RouteDeps) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId, ideaId } = request.params as {
      projectId: string;
      ideaId: string;
    };

    const project = deps.projectStore
      .getAll()
      .find((item) => item.id === projectId);
    if (!project) return reply.status(404).send({ error: "Project not found" });

    const idea = deps.boardStore
      .getBoard(projectId, project.repoPath)
      .ideas.find((item) => item.id === ideaId);
    if (!idea) return reply.status(404).send({ error: "Idea not found" });

    const body = isRecord(request.body) ? request.body : {};
    const prompt =
      typeof body.prompt === "string" && body.prompt.trim()
        ? body.prompt.trim()
        : idea.brief;

    try {
      const result = await deps.sessionManager.startIdea(
        projectId,
        idea,
        prompt,
        project.repoPath
      );
      return reply.send({ ...result, projectId, ideaId });
    } catch (error) {
      return reply.status(409).send({
        error:
          error instanceof Error
            ? error.message
            : "Could not start Idea elaboration",
      });
    }
  };
}
