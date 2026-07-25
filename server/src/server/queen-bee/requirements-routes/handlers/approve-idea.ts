/** @private — only imported by register-routes.ts */

import type { FastifyReply, FastifyRequest } from "fastify";
import { planningResponse } from "../../planning-response";
import { approvedDraft } from "../approved-draft";
import type { RouteDeps } from "../types";

export function approveIdeaHandler(deps: RouteDeps) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId, ideaId } = request.params as {
      projectId: string;
      ideaId: string;
    };

    const project = deps.projectStore
      .getAll()
      .find((item) => item.id === projectId);
    if (!project) return reply.status(404).send({ error: "Project not found" });

    const session = deps.sessionManager.getIdeaSession(projectId, ideaId);
    const draft = approvedDraft(session, project.repoPath);
    if (!draft.ok) return reply.status(409).send({ error: draft.error });

    try {
      const outcome = await deps.planningManager.propose(
        projectId,
        project.repoPath,
        draft.content,
        `Resolve Idea '${ideaId}' into one or more existing or new Cards.`,
        { ideaId, target: "resolved" }
      );
      deps.sessionManager.submitForPlanning(
        projectId,
        draft.sessionId,
        outcome.id
      );
      return reply.send({ approved: true, ...planningResponse(outcome) });
    } catch (error) {
      return reply.status(500).send({
        error: error instanceof Error ? error.message : "Could not plan Idea",
      });
    }
  };
}
