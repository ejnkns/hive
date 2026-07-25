/** @private — only imported by register-routes.ts */

import type { FastifyReply, FastifyRequest } from "fastify";
import { isRecord } from "shared/board-types";
import type { RouteDeps } from "../types";

export function startRevisionHandler(deps: RouteDeps) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId } = request.params as { projectId: string };
    const body = isRecord(request.body) ? request.body : {};

    if (!body.prompt || typeof body.prompt !== "string") {
      return reply.status(400).send({ error: "prompt is required" });
    }

    const project = deps.projectStore
      .getAll()
      .find((item) => item.id === projectId);
    if (!project) return reply.status(404).send({ error: "Project not found" });

    const activeCards = deps.boardStore
      .getBoard(projectId, project.repoPath)
      .cards.filter(
        (card) => card.column === "in_progress" || card.column === "reviewing"
      );
    if (activeCards.length > 0 && !body.confirmActive) {
      return reply.status(409).send({
        error: "Active work may no longer match regenerated requirements",
        requiresConfirmation: true,
        activeCardIds: activeCards.map((c) => c.id),
      });
    }

    try {
      const proposalId =
        typeof body.proposalId === "string" ? body.proposalId : undefined;
      if (proposalId) {
        const proposal = deps.planningManager.getProposal(
          projectId,
          proposalId
        );
        if (proposal?.status !== "pending") {
          return reply
            .status(409)
            .send({ error: "Replacement Planning Proposal is not pending" });
        }
      }
      const result = await deps.sessionManager.startRevision(
        projectId,
        `Revise the project requirements before regenerating the board. Preserve confirmed scope unless the user explicitly changes it.\n\nUser context: ${body.prompt}`,
        project.repoPath,
        proposalId
      );
      if (proposalId) {
        deps.planningManager.cancelProposal(projectId, proposalId);
      }
      return reply.send({
        question: result.question,
        draftRequirements: result.draftRequirements,
        projectId,
        redevise: true,
      });
    } catch (err) {
      return reply.status(500).send({
        error:
          err instanceof Error ? err.message : "Requirements Revision failed",
      });
    }
  };
}
