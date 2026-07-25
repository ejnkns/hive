/** @private — only imported by register-routes.ts */

import type { FastifyReply, FastifyRequest } from "fastify";
import { loadProjectContext } from "../../project-context";
import {
  readRequirements,
  requirementsRevision,
} from "../../requirements-store";
import type { RouteDeps } from "../types";

export function repairStartHandler(deps: RouteDeps) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId, feedbackId } = request.params as {
      projectId: string;
      feedbackId: string;
    };

    const project = deps.projectStore
      .getAll()
      .find((item) => item.id === projectId);
    if (!project) return reply.status(404).send({ error: "Project not found" });

    const feedback = deps.planningManager.getRequirementsFeedback(
      projectId,
      feedbackId
    );
    if (!feedback) {
      return reply
        .status(404)
        .send({ error: "Requirements Feedback not found" });
    }
    if (
      requirementsRevision(readRequirements(project.repoPath)) !==
      feedback.baseRequirementsRevision
    ) {
      return reply.status(409).send({
        error:
          "Canonical requirements changed after this feedback was created; restart planning from the current requirements",
      });
    }
    if (feedback.projectRevision !== null) {
      try {
        if (
          loadProjectContext(projectId, project.repoPath).revision !==
          feedback.projectRevision
        ) {
          return reply.status(409).send({
            error:
              "Project revision changed after this feedback was created; restart planning",
          });
        }
      } catch {
        return reply
          .status(409)
          .send({ error: "Could not verify the Project revision" });
      }
    }

    try {
      const sourceIdea = feedback.sourceIdeaId
        ? deps.boardStore
            .getBoard(projectId, project.repoPath)
            .ideas.find((idea) => idea.id === feedback.sourceIdeaId)
        : undefined;
      if (feedback.sourceIdeaId && !sourceIdea) {
        return reply.status(409).send({
          error: "Source Idea is no longer available; restart Idea planning",
        });
      }
      const result = await deps.sessionManager.startRepair(
        projectId,
        feedback,
        project.repoPath,
        sourceIdea
      );
      return reply.send({ ...result, feedbackId });
    } catch (error) {
      return reply.status(409).send({
        error:
          error instanceof Error
            ? error.message
            : "Could not start Requirements Repair",
      });
    }
  };
}
