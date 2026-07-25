/** @private — only imported by register-routes.ts */

import type { FastifyReply, FastifyRequest } from "fastify";
import { readRequirements } from "../../requirements-store";
import type { RouteDeps } from "../types";

export function getPhaseHandler(deps: RouteDeps) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId } = request.params as { projectId: string };

    const project = deps.projectStore.getAll().find((p) => p.id === projectId);
    if (!project) {
      return reply.status(404).send({ error: "Project not found" });
    }

    const requirementsContent = readRequirements(project.repoPath);
    const hasRequirements = requirementsContent.length > 0;

    const openOutcome = deps.planningManager.getOpenOutcome(projectId);
    if (openOutcome) {
      return reply.send({
        phase: "planning",
        outcome:
          "kind" in openOutcome
            ? { feedback: openOutcome }
            : { proposal: openOutcome },
        requirementsContent: hasRequirements ? requirementsContent : null,
      });
    }

    const session = deps.sessionManager.getSession(projectId);
    if (session && session.status !== "submitted") {
      return reply.send({
        phase: "requirements",
        requirementsContent: hasRequirements ? requirementsContent : null,
        session: {
          status: session.status,
          kind: session.kind,
          draftRequirements: session.draftRequirements,
          messages: session.messages
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({ role: m.role, content: m.content })),
        },
      });
    }

    const board = deps.boardStore.getBoard(projectId, project.repoPath);
    const hasBoard = board.cards.length > 0 || board.ideas.length > 0;

    return reply.send({
      phase: hasRequirements ? "board" : "no_requirements",
      requirementsContent: hasRequirements ? requirementsContent : null,
      hasBoard,
    });
  };
}
