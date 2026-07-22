/** @private — only imported by queen-bee.ts */

import type { FastifyInstance } from "fastify";
import type { PlanningOutcome } from "shared/board-types";
import type { BoardStore } from "./board-store";
import type { ProjectStore } from "./create-project-store";
import type { RequirementsSessionManager } from "./devise-engine";
import type { PlanningManager } from "./planner";
import { loadProjectContext } from "./project-context";
import { readRequirements, requirementsRevision } from "./requirements-store";

export function registerRequirementsRoutes(
  server: FastifyInstance,
  deps: {
    sessionManager: RequirementsSessionManager;
    projectStore: ProjectStore;
    boardStore: BoardStore;
    planningManager: PlanningManager;
  }
): void {
  // Fastify derives every `request.params` object below from its static route
  // pattern; these casts bridge the untyped shared server instance.
  server.post(
    "/api/queen-bee/:projectId/requirements/revision/start",
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const body = isRecord(request.body) ? request.body : {};
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
    }
  );

  server.post(
    "/api/queen-bee/:projectId/ideas/:ideaId/requirements/start",
    async (request, reply) => {
      const { projectId, ideaId } = request.params as {
        projectId: string;
        ideaId: string;
      };
      const project = deps.projectStore
        .getAll()
        .find((item) => item.id === projectId);
      if (!project)
        return reply.status(404).send({ error: "Project not found" });
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
    }
  );

  server.post(
    "/api/queen-bee/:projectId/ideas/:ideaId/requirements/respond",
    async (request, reply) => {
      const { projectId, ideaId } = request.params as {
        projectId: string;
        ideaId: string;
      };
      const project = deps.projectStore
        .getAll()
        .find((item) => item.id === projectId);
      if (!project)
        return reply.status(404).send({ error: "Project not found" });
      const body = isRecord(request.body) ? request.body : {};
      if (typeof body.answer !== "string" || !body.answer.trim()) {
        return reply.status(400).send({ error: "answer is required" });
      }
      try {
        const result = await deps.sessionManager.respondIdea(
          projectId,
          ideaId,
          body.answer.trim(),
          project.repoPath
        );
        return reply.send({ ...result, complete: result.type === "complete" });
      } catch (error) {
        return reply.status(409).send({
          error:
            error instanceof Error ? error.message : "Idea elaboration failed",
        });
      }
    }
  );

  server.post(
    "/api/queen-bee/:projectId/ideas/:ideaId/requirements/approve",
    async (request, reply) => {
      const { projectId, ideaId } = request.params as {
        projectId: string;
        ideaId: string;
      };
      const project = deps.projectStore
        .getAll()
        .find((item) => item.id === projectId);
      if (!project)
        return reply.status(404).send({ error: "Project not found" });
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
    }
  );

  server.post(
    "/api/queen-bee/:projectId/requirements-feedback/:feedbackId/repair/start",
    async (request, reply) => {
      const { projectId, feedbackId } = request.params as {
        projectId: string;
        feedbackId: string;
      };
      const project = deps.projectStore
        .getAll()
        .find((item) => item.id === projectId);
      if (!project)
        return reply.status(404).send({ error: "Project not found" });
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
    }
  );

  server.get(
    "/api/queen-bee/:projectId/ideas/:ideaId/requirements/session",
    async (request, reply) => {
      const { projectId, ideaId } = request.params as {
        projectId: string;
        ideaId: string;
      };
      const session = deps.sessionManager.getIdeaSession(projectId, ideaId);
      if (!session) return reply.send({ active: false });
      if (session.status === "submitted") {
        return reply.send({ active: false, status: session.status });
      }
      return reply.send({
        active: true,
        status: session.status,
        kind: session.kind,
        question: session.messages
          .filter((message) => message.role === "assistant")
          .at(-1)?.content,
        draftRequirements: session.draftRequirements,
      });
    }
  );

  server.post(
    "/api/queen-bee/:projectId/cards/:cardId/requirements/start",
    async (request, reply) => {
      const { projectId, cardId } = request.params as {
        projectId: string;
        cardId: string;
      };
      const body = isRecord(request.body) ? request.body : {};
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
        const result = await deps.sessionManager.startCard(
          projectId,
          cardId,
          [
            "Repair the project requirements using the user's card-scoped concern without inspecting Board or Card content.",
            `User decision context: ${body.prompt}`,
            "Update only the complete project Requirements Draft. The Planner Agent will independently propose any Card changes after user approval.",
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
            err instanceof Error
              ? err.message
              : "Card Requirements Session failed",
        });
      }
    }
  );

  server.post(
    "/api/queen-bee/:projectId/cards/:cardId/requirements/respond",
    async (request, reply) => {
      const { projectId, cardId } = request.params as {
        projectId: string;
        cardId: string;
      };
      const body = isRecord(request.body) ? request.body : {};
      if (!body.answer || typeof body.answer !== "string") {
        return reply.status(400).send({ error: "answer is required" });
      }
      const project = deps.projectStore
        .getAll()
        .find((item) => item.id === projectId);
      if (!project)
        return reply.status(404).send({ error: "Project not found" });

      try {
        const result = await deps.sessionManager.respondCard(
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
          return reply.send({
            complete: true,
            spec: result.spec,
            draftRequirements: result.draftRequirements,
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
            err instanceof Error
              ? err.message
              : "Card Requirements Session response failed",
        });
      }
    }
  );

  server.post(
    "/api/queen-bee/:projectId/requirements/start",
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const body = isRecord(request.body) ? request.body : {};

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
        const result = await deps.sessionManager.start(
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
          error:
            err instanceof Error ? err.message : "Requirements Session failed",
        });
      }
    }
  );

  server.post(
    "/api/queen-bee/:projectId/requirements/respond",
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const body = isRecord(request.body) ? request.body : {};

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
        const result = await deps.sessionManager.respond(
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
          error:
            err instanceof Error
              ? err.message
              : "Requirements Session response failed",
        });
      }
    }
  );

  server.post(
    "/api/queen-bee/:projectId/requirements/approve",
    async (request, reply) => {
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
    }
  );

  server.post(
    "/api/queen-bee/:projectId/cards/:cardId/requirements/approve",
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
      const session = deps.sessionManager.getCardSession(projectId, cardId);
      const draft = approvedDraft(session, project.repoPath);
      if (!draft.ok) return reply.status(409).send({ error: draft.error });

      try {
        const outcome = await deps.planningManager.propose(
          projectId,
          project.repoPath,
          draft.content,
          [
            `The user approved a refinement of card '${cardId}'.`,
            "Independently propose the complete Card Specification from the approved Requirements Draft and Project Context.",
            "Reconcile every other Card without using Requirements Agent conversation history.",
          ].join("\n"),
          { cardId, target: "ready" }
        );
        deps.sessionManager.submitForPlanning(
          projectId,
          draft.sessionId,
          outcome.id
        );
        return reply.send({ approved: true, ...planningResponse(outcome) });
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

  server.get("/api/queen-bee/:projectId/phase", async (request, reply) => {
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
  });

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

      const content = readRequirements(project.repoPath);
      if (content) {
        return reply.send({ content });
      }
      return reply.status(404).send({ error: "Requirements not found" });
    }
  );
}

function approvedDraft(
  session: ReturnType<RequirementsSessionManager["getSession"]>,
  repoPath: string
):
  | { ok: true; content: string; sessionId: string }
  | { ok: false; error: string } {
  if (session?.status !== "complete" || !session.draftRequirements) {
    return {
      ok: false,
      error: "Requirements Session has no completed draft",
    };
  }
  if (
    requirementsRevision(readRequirements(repoPath)) !==
    session.baseRequirementsRevision
  ) {
    return {
      ok: false,
      error:
        "Canonical requirements changed after this Requirements Session started; start a new revision",
    };
  }
  if (session.projectRevision !== null) {
    try {
      if (
        loadProjectContext(session.projectId, repoPath).revision !==
        session.projectRevision
      ) {
        return {
          ok: false,
          error:
            "Project revision changed after this Requirements Session started; start a fresh session",
        };
      }
    } catch {
      return { ok: false, error: "Could not verify the Project revision" };
    }
  }
  return {
    ok: true,
    content: session.draftRequirements,
    sessionId: session.sessionId,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function planningResponse(outcome: PlanningOutcome) {
  return "kind" in outcome ? { feedback: outcome } : { proposal: outcome };
}
