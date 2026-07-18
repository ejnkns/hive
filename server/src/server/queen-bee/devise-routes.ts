/** @private — only imported by queen-bee.ts */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { BoardStore } from "./board-store";
import type { ProjectStore } from "./create-project-store";
import type { DeviseEngine } from "./devise-engine";
import type { Planner } from "./planner";
import { readRequirements, requirementsRevision } from "./requirements-store";

export function registerDeviseRoutes(
  server: FastifyInstance,
  deps: {
    engine: DeviseEngine;
    projectStore: ProjectStore;
    boardStore: BoardStore;
    planner: Planner;
  }
): void {
  server.post(
    "/api/queen-bee/:projectId/devise/redevise/start",
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const body = request.body as { prompt?: string; confirmActive?: boolean };
      if (!body.prompt || typeof body.prompt !== "string") {
        return reply.status(400).send({ error: "prompt is required" });
      }

      const project = deps.projectStore
        .getAll()
        .find((item) => item.id === projectId);
      if (!project)
        return reply.status(404).send({ error: "Project not found" });

      const activeCards = deps.boardStore
        .getBoard(projectId, project.repoPath)
        .cards.filter(
          (card) => card.column === "in_progress" || card.column === "reviewing"
        );
      if (activeCards.length > 0 && !body.confirmActive) {
        return reply.status(409).send({
          error: "Active work may no longer match regenerated requirements",
          requiresConfirmation: true,
          activeCardIds: activeCards.map((card) => card.id),
        });
      }

      try {
        const result = await deps.engine.start(
          projectId,
          `Re-devise the project requirements before regenerating the board. Preserve confirmed scope unless the user explicitly changes it.\n\nUser context: ${body.prompt}`,
          project.repoPath
        );
        return reply.send({
          question: result.question,
          draftRequirements: result.draftRequirements,
          projectId,
          redevise: true,
        });
      } catch (err) {
        return reply.status(500).send({
          error:
            err instanceof Error ? err.message : "Re-devise session failed",
        });
      }
    }
  );

  server.post(
    "/api/queen-bee/:projectId/cards/:cardId/devise/start",
    async (request, reply) => {
      const { projectId, cardId } = request.params as {
        projectId: string;
        cardId: string;
      };
      const body = request.body as { prompt?: string };
      if (!body.prompt || typeof body.prompt !== "string") {
        return reply.status(400).send({ error: "prompt is required" });
      }
      const project = deps.projectStore
        .getAll()
        .find((item) => item.id === projectId);
      if (!project)
        return reply.status(404).send({ error: "Project not found" });
      const card = deps.boardStore
        .getBoard(projectId, project.repoPath)
        .cards.find((item) => item.id === cardId);
      if (!card) return reply.status(404).send({ error: "Card not found" });

      try {
        const result = await deps.engine.startCard(
          projectId,
          cardId,
          [
            "Refine this one card while keeping the project requirements document aligned.",
            `Card title: ${card.title}`,
            `Current card description: ${card.description}`,
            `User context: ${body.prompt}`,
            "When complete, output CARD_UPDATE followed by a json code fence containing description, acceptanceCriteria, relevantFiles, and requirementRefs for this card, then REQUIREMENTS_COMPLETE. Also call update_requirements_draft with the full aligned project requirements document.",
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
            err instanceof Error ? err.message : "Card devise session failed",
        });
      }
    }
  );

  server.post(
    "/api/queen-bee/:projectId/cards/:cardId/devise/respond",
    async (request, reply) => {
      const { projectId, cardId } = request.params as {
        projectId: string;
        cardId: string;
      };
      const body = request.body as { answer?: string };
      if (!body.answer || typeof body.answer !== "string") {
        return reply.status(400).send({ error: "answer is required" });
      }
      const project = deps.projectStore
        .getAll()
        .find((item) => item.id === projectId);
      if (!project)
        return reply.status(404).send({ error: "Project not found" });

      try {
        const result = await deps.engine.respondCard(
          projectId,
          cardId,
          body.answer,
          project.repoPath
        );
        if (result.type === "complete") {
          if (!result.draftRequirements.trim()) {
            return reply.status(422).send({
              error:
                "Card devise completed without an aligned requirements draft",
            });
          }
          const patch = parseCardPatch(result.spec);
          if (!patch) {
            return reply.status(422).send({
              error: "Card devise completed without a structured card update",
            });
          }
          return reply.send({
            complete: true,
            spec: result.spec,
            draftRequirements: result.draftRequirements,
            cardProposal: patch,
            projectId,
            cardId,
          });
        }
        return reply.send({
          question: result.question,
          draftRequirements: result.draftRequirements,
          projectId,
          cardId,
        });
      } catch (err) {
        return reply.status(500).send({
          error:
            err instanceof Error ? err.message : "Card devise response failed",
        });
      }
    }
  );

  server.post(
    "/api/queen-bee/:projectId/devise/start",
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const body = request.body as { prompt?: string };

      if (!body.prompt || typeof body.prompt !== "string") {
        return reply.status(400).send({ error: "prompt is required" });
      }

      const project = deps.projectStore
        .getAll()
        .find((p) => p.id === projectId);
      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }

      try {
        const result = await deps.engine.start(
          projectId,
          body.prompt,
          project.repoPath
        );
        return reply.send({
          question: result.question,
          draftRequirements: result.draftRequirements,
          projectId,
        });
      } catch (err) {
        return reply.status(500).send({
          error: err instanceof Error ? err.message : "Devise session failed",
        });
      }
    }
  );

  server.post(
    "/api/queen-bee/:projectId/devise/respond",
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const body = request.body as { answer?: string };

      if (!body.answer || typeof body.answer !== "string") {
        return reply.status(400).send({ error: "answer is required" });
      }

      const project = deps.projectStore
        .getAll()
        .find((p) => p.id === projectId);
      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }

      try {
        const result = await deps.engine.respond(
          projectId,
          body.answer,
          project.repoPath
        );

        if (result.type === "complete") {
          return reply.send({
            complete: true,
            spec: result.spec,
            draftRequirements: result.draftRequirements,
            projectId,
          });
        }

        return reply.send({
          question: result.question,
          draftRequirements: result.draftRequirements,
          projectId,
        });
      } catch (err) {
        return reply.status(500).send({
          error: err instanceof Error ? err.message : "Devise response failed",
        });
      }
    }
  );

  server.post(
    "/api/queen-bee/:projectId/devise/approve",
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const project = deps.projectStore
        .getAll()
        .find((item) => item.id === projectId);
      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }
      const draft = approvedDraft(
        deps.engine.getSession(projectId),
        project.repoPath
      );
      if (!draft.ok) return reply.status(409).send({ error: draft.error });

      try {
        const proposal = await deps.planner.propose(
          projectId,
          project.repoPath,
          draft.content,
          "The user explicitly approved this Devise Agent requirements draft. Reconcile every card before anything becomes canonical."
        );
        return reply.send({ approved: true, proposal });
      } catch (error) {
        return reply.status(500).send({
          error:
            error instanceof Error
              ? error.message
              : "Could not reconcile the approved draft",
        });
      }
    }
  );

  server.post(
    "/api/queen-bee/:projectId/cards/:cardId/devise/approve",
    async (request, reply) => {
      const { projectId, cardId } = request.params as {
        projectId: string;
        cardId: string;
      };
      const project = deps.projectStore
        .getAll()
        .find((item) => item.id === projectId);
      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }
      const session = deps.engine.getCardSession(projectId, cardId);
      const draft = approvedDraft(session, project.repoPath);
      if (!draft.ok) return reply.status(409).send({ error: draft.error });
      const patch = parseCardPatch(session?.messages.at(-1)?.content ?? "");
      if (!patch) {
        return reply.status(409).send({ error: "Card proposal is missing" });
      }

      try {
        const proposal = await deps.planner.propose(
          projectId,
          project.repoPath,
          draft.content,
          [
            `The user approved a refinement of card '${cardId}'.`,
            "Use this exact approved card patch when reconciling that card:",
            JSON.stringify(patch, null, 2),
            "Reconcile every other card against the project-wide requirements draft. The selected card must remain provisional until the planning proposal is accepted.",
          ].join("\n")
        );
        return reply.send({ proposal, approved: true });
      } catch (error) {
        return reply.status(500).send({
          error:
            error instanceof Error
              ? error.message
              : "Could not reconcile the card refinement",
        });
      }
    }
  );

  server.get(
    "/api/queen-bee/:projectId/devise/status",
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };

      const project = deps.projectStore
        .getAll()
        .find((p) => p.id === projectId);
      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }

      const requirementsPath = join(
        project.repoPath,
        ".hive",
        "requirements.md"
      );
      const hasRequirements = existsSync(requirementsPath);

      return reply.send({ projectId, hasRequirements });
    }
  );

  server.get(
    "/api/queen-bee/:projectId/requirements",
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };

      const project = deps.projectStore
        .getAll()
        .find((p) => p.id === projectId);
      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }

      const requirementsPath = join(
        project.repoPath,
        ".hive",
        "requirements.md"
      );

      try {
        const content = readFileSync(requirementsPath, "utf-8");
        return reply.send({ content });
      } catch {
        return reply.status(404).send({ error: "Requirements not found" });
      }
    }
  );

  server.get(
    "/api/queen-bee/:projectId/devise/session",
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const session = deps.engine.getSession(projectId);

      if (!session) {
        return reply.send({ active: false });
      }

      const clientMessages = session.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role,
          content: m.content,
        }));

      return reply.send({
        active: true,
        status: session.status,
        draftRequirements: session.draftRequirements,
        baseRequirementsRevision: session.baseRequirementsRevision,
        cardId: session.cardId,
        messages: clientMessages,
      });
    }
  );
}

function approvedDraft(
  session: ReturnType<DeviseEngine["getSession"]>,
  repoPath: string
): { ok: true; content: string } | { ok: false; error: string } {
  if (session?.status !== "complete" || !session.draftRequirements) {
    return { ok: false, error: "Devise session has no completed draft" };
  }
  if (
    requirementsRevision(readRequirements(repoPath)) !==
    session.baseRequirementsRevision
  ) {
    return {
      ok: false,
      error:
        "Canonical requirements changed after this Devise session started; start a new revision",
    };
  }
  return { ok: true, content: session.draftRequirements };
}

function parseCardPatch(content: string): {
  description?: string;
  acceptanceCriteria?: string[];
  relevantFiles?: string[];
  requirementRefs?: string[];
} | null {
  const match = content.match(/CARD_UPDATE\s*```json\s*([\s\S]*?)```/i);
  if (!match) return null;
  try {
    const value = JSON.parse(match[1]) as Record<string, unknown>;
    const patch = {
      description:
        typeof value.description === "string" ? value.description : undefined,
      acceptanceCriteria: Array.isArray(value.acceptanceCriteria)
        ? value.acceptanceCriteria.filter(
            (item): item is string => typeof item === "string"
          )
        : undefined,
      relevantFiles: Array.isArray(value.relevantFiles)
        ? value.relevantFiles.filter(
            (item): item is string => typeof item === "string"
          )
        : undefined,
      requirementRefs: Array.isArray(value.requirementRefs)
        ? value.requirementRefs.filter(
            (item): item is string => typeof item === "string"
          )
        : undefined,
    };
    return Object.values(patch).some((value) => value !== undefined)
      ? patch
      : null;
  } catch {
    return null;
  }
}
