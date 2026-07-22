/** @private — only imported by queen-bee.ts */

import type { FastifyInstance } from "fastify";
import type { CoordinatorAction } from "shared/board-types";
import { isRecord } from "shared/board-types";
import type { BoardStore } from "./board-store";
import type { ProjectStore } from "./create-project-store";
import type { RequirementsSessionManager } from "./devise-engine";
import type { PlanningManager } from "./planner";
import { planningResponse } from "./planning-response";
import { readRequirements, requirementsRevision } from "./requirements-store";

export function registerCoordinatorRoutes(
  server: FastifyInstance,
  deps: {
    boardStore: BoardStore;
    projectStore: ProjectStore;
    sessionManager: RequirementsSessionManager;
    planningManager: PlanningManager;
  }
): void {
  const inFlightRemediations = new Set<string>();

  server.post(
    "/api/queen-bee/:projectId/cards/:cardId/remediate",
    async (request, reply) => {
      const { projectId, cardId } = request.params as {
        projectId: string;
        cardId: string;
      };
      const body = isRecord(request.body) ? request.body : {};
      const project = deps.projectStore
        .getAll()
        .find((item) => item.id === projectId);
      if (!project)
        return reply.status(404).send({ error: "Project not found" });

      const card = deps.boardStore
        .getBoard(projectId, project.repoPath)
        .cards.find((item) => item.id === cardId);
      if (!card) return reply.status(404).send({ error: "Card not found" });
      if (!isCoordinatorAction(body.action)) {
        return reply.status(400).send({ error: "action is invalid" });
      }

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

      const remediationKey = `${projectId}:${cardId}`;
      if (inFlightRemediations.has(remediationKey)) {
        return reply.status(409).send({
          error: "A remediation is already being prepared for this Card",
        });
      }
      inFlightRemediations.add(remediationKey);

      try {
        if (body.action === "archive") {
          if (!suggestion.requirementsContent) {
            return reply.status(400).send({
              error:
                "Archive requires a complete requirements revision that removes or defers the abandoned scope",
            });
          }
          try {
            const outcome = await deps.planningManager.propose(
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
            return reply.send(planningResponse(outcome));
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
          const result = await deps.sessionManager.startCard(
            projectId,
            cardId,
            [
              "Repair the project requirements using structured Coordinator feedback without inspecting Board or Card content.",
              `Structured feedback: ${suggestion.rationale}`,
              "Ask the user for the decision needed to make this card fulfillable.",
              "When complete, call update_requirements_draft with the full aligned project Requirements Draft, then output REQUIREMENTS_COMPLETE. Do not author Card content; the Planner Agent will independently reconcile Cards after user approval.",
            ].join("\n"),
            project.repoPath
          );
          return reply.send({
            card,
            kind: "redevise" as const,
            question: result.question,
          });
        }

        if (!suggestion.cardPatch || !suggestion.requirementsContent) {
          return reply.status(400).send({
            error: "Suggestion does not include a complete remediation patch",
          });
        }

        try {
          const outcome = await deps.planningManager.propose(
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
          return reply.send(planningResponse(outcome));
        } catch (error) {
          return reply.status(500).send({
            error:
              error instanceof Error
                ? error.message
                : "Could not reconcile the remediation",
          });
        }
      } finally {
        inFlightRemediations.delete(remediationKey);
      }
    }
  );
}

function isCoordinatorAction(value: unknown): value is CoordinatorAction {
  return ["retry_with_patch", "redevise", "archive"].includes(String(value));
}
