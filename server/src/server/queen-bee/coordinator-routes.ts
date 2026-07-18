/** @private — only imported by queen-bee.ts */

import type { FastifyInstance } from "fastify";
import type { CoordinatorAction } from "shared/board-types";
import type { BoardStore } from "./board-store";
import type { ProjectStore } from "./create-project-store";
import {
  readRequirements,
  requirementsRevision,
  writeRequirements,
} from "./requirements-store";

export function registerCoordinatorRoutes(
  server: FastifyInstance,
  deps: { boardStore: BoardStore; projectStore: ProjectStore }
): void {
  server.post(
    "/api/queen-bee/:projectId/cards/:cardId/remediate",
    async (request, reply) => {
      const { projectId, cardId } = request.params as {
        projectId: string;
        cardId: string;
      };
      const body = request.body as {
        action?: CoordinatorAction;
        suggestionId?: string;
      };
      const project = deps.projectStore
        .getAll()
        .find((item) => item.id === projectId);
      if (!project)
        return reply.status(404).send({ error: "Project not found" });

      const card = deps.boardStore
        .getBoard(projectId, project.repoPath)
        .cards.find((item) => item.id === cardId);
      if (!card) return reply.status(404).send({ error: "Card not found" });
      if (!body.action)
        return reply.status(400).send({ error: "action is required" });

      const suggestion = card.coordinatorLog?.suggestions?.find(
        (item) => item.id === body.suggestionId && item.action === body.action
      );
      if (!suggestion) {
        return reply
          .status(400)
          .send({ error: "Matching coordinator suggestion is required" });
      }

      if (body.action === "archive") {
        return reply.send({
          card: deps.boardStore.archiveCard(
            projectId,
            project.repoPath,
            cardId
          ),
        });
      }

      if (body.action === "redevise") {
        const updated = deps.boardStore.updateCard(
          projectId,
          project.repoPath,
          cardId,
          {
            column: "idea",
          }
        );
        return reply.send({ card: updated, redevise: true });
      }

      if (!suggestion.cardPatch || !suggestion.requirementsContent) {
        return reply.status(400).send({
          error: "Suggestion does not include a complete remediation patch",
        });
      }

      const currentRequirements = readRequirements(project.repoPath);
      const expectedRevision = card.coordinatorLog?.requirementsRevision;
      if (
        expectedRevision &&
        requirementsRevision(currentRequirements) !== expectedRevision
      ) {
        return reply.status(409).send({
          error:
            "Requirements changed after this analysis. Retry coordination.",
        });
      }

      writeRequirements(project.repoPath, suggestion.requirementsContent);
      const updated = deps.boardStore.updateCard(
        projectId,
        project.repoPath,
        cardId,
        {
          ...suggestion.cardPatch,
          column: "ready",
          handover: undefined,
          coordinatorLog: undefined,
        }
      );
      return reply.send({ card: updated });
    }
  );
}
