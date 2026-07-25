/** @private — only imported by register-routes.ts */

import type { FastifyReply, FastifyRequest } from "fastify";
import { planningResponse } from "../../planning-response";
import { approvedDraft } from "../approved-draft";
import type { RouteDeps } from "../types";

export function approveRequirementsHandler(deps: RouteDeps) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId } = request.params as { projectId: string };

    const project = deps.projectStore
      .getAll()
      .find((item) => item.id === projectId);
    if (!project) {
      return reply.status(404).send({ error: "Project not found" });
    }

    const session = deps.sessionManager.getSession(projectId);
    const draft = approvedDraft(session, project.repoPath);
    if (!draft.ok) return reply.status(409).send({ error: draft.error });

    try {
      const outcome = await deps.planningManager.propose(
        projectId,
        project.repoPath,
        draft.content,
        "The user explicitly approved this Requirements Agent draft. Reconcile every Card before anything becomes canonical.",
        session?.sourceIdeaId
          ? { ideaId: session.sourceIdeaId, target: "resolved" }
          : undefined
      );
      deps.sessionManager.submitForPlanning(
        projectId,
        draft.sessionId,
        outcome.id
      );
      if (session?.sourceFeedbackId) {
        deps.planningManager.resolveRequirementsFeedback(
          projectId,
          session.sourceFeedbackId
        );
      }
      return reply.send({ approved: true, ...planningResponse(outcome) });
    } catch (error) {
      return reply.status(500).send({
        error:
          error instanceof Error
            ? error.message
            : "Could not reconcile the approved draft",
      });
    }
  };
}
