/** @private — only imported by queen-bee.ts */

import type { FastifyInstance } from "fastify";
import type { CoordinatorAction } from "shared/board-types";
import type { BoardStore } from "./board-store";
import type { ProjectStore } from "./create-project-store";
import type { DeviseEngine } from "./devise-engine";
import type { Planner } from "./planner";
import { readRequirements, requirementsRevision } from "./requirements-store";

export function registerCoordinatorRoutes(
  server: FastifyInstance,
  deps: {
    boardStore: BoardStore;
    projectStore: ProjectStore;
    engine: DeviseEngine;
    planner: Planner;
  }
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

      if (body.action === "archive") {
        if (!suggestion.requirementsContent) {
          return reply.status(400).send({
            error:
              "Archive requires a complete requirements revision that removes or defers the abandoned scope",
          });
        }
        try {
          const proposal = await deps.planner.propose(
            projectId,
            project.repoPath,
            suggestion.requirementsContent,
            [
              `The user selected the Coordinator's archive remediation for card '${cardId}'.`,
              `Rationale: ${suggestion.rationale}`,
              "Remove this card from the active plan and reconcile every other card against the revised requirements.",
            ].join("\n"),
            { cardId, target: "archived" }
          );
          return reply.send({ proposal });
        } catch (error) {
          return reply.status(500).send({
            error:
              error instanceof Error
                ? error.message
                : "Could not reconcile the archive",
          });
        }
      }

      if (body.action === "redevise") {
        const result = await deps.engine.startCard(
          projectId,
          cardId,
          [
            "Resolve this card's unfulfillable handover by refining the card while keeping the project requirements document aligned.",
            `Card title: ${card.title}`,
            `Current card description: ${card.description}`,
            `Coordinator rationale: ${suggestion.rationale}`,
            "Ask the user for the decision needed to make this card fulfillable.",
            "When complete, output CARD_UPDATE followed by a json code fence containing description, acceptanceCriteria, relevantFiles, and requirementRefs for this card, then REQUIREMENTS_COMPLETE. Also call update_requirements_draft with the full aligned project requirements document.",
          ].join("\n"),
          project.repoPath
        );
        const updated = deps.boardStore.updateCard(
          projectId,
          project.repoPath,
          cardId,
          {
            column: "idea",
          }
        );
        return reply.send({
          card: updated,
          redevise: true,
          question: result.question,
        });
      }

      if (!suggestion.cardPatch || !suggestion.requirementsContent) {
        return reply.status(400).send({
          error: "Suggestion does not include a complete remediation patch",
        });
      }

      try {
        const proposal = await deps.planner.propose(
          projectId,
          project.repoPath,
          suggestion.requirementsContent,
          [
            `The user selected the Coordinator's retry_with_patch remediation for card '${cardId}'.`,
            "Use this approved card patch when reconciling that card:",
            JSON.stringify(suggestion.cardPatch, null, 2),
            "Reconcile every other card against the updated project requirements before applying anything.",
          ].join("\n"),
          { cardId, target: "ready" }
        );
        return reply.send({ proposal });
      } catch (error) {
        return reply.status(500).send({
          error:
            error instanceof Error
              ? error.message
              : "Could not reconcile the remediation",
        });
      }
    }
  );
}
