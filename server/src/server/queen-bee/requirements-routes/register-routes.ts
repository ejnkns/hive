/** @private — only imported by requirements-routes.ts */

import type { FastifyInstance } from "fastify";
import { approveCardHandler } from "./handlers/approve-card";
import { approveIdeaHandler } from "./handlers/approve-idea";
import { approveRequirementsHandler } from "./handlers/approve-requirements";
import { getIdeaSessionHandler } from "./handlers/get-idea-session";
import { getPhaseHandler } from "./handlers/get-phase";
import { getRequirementsHandler } from "./handlers/get-requirements";
import { repairStartHandler } from "./handlers/repair-start";
import { resetSessionHandler } from "./handlers/reset-session";
import { respondCardHandler } from "./handlers/respond-card";
import { respondIdeaHandler } from "./handlers/respond-idea";
import { respondRequirementsHandler } from "./handlers/respond-requirements";
import { startCardHandler } from "./handlers/start-card";
import { startIdeaHandler } from "./handlers/start-idea";
import { startRequirementsHandler } from "./handlers/start-requirements";
import { startRevisionHandler } from "./handlers/start-revision";
import type { RouteDeps } from "./types";

export function registerRequirementsRoutes(
  server: FastifyInstance,
  deps: RouteDeps
): void {
  server.post(
    "/api/queen-bee/:projectId/requirements/revision/start",
    startRevisionHandler(deps)
  );

  server.post(
    "/api/queen-bee/:projectId/ideas/:ideaId/requirements/start",
    startIdeaHandler(deps)
  );

  server.post(
    "/api/queen-bee/:projectId/ideas/:ideaId/requirements/respond",
    respondIdeaHandler(deps)
  );

  server.post(
    "/api/queen-bee/:projectId/ideas/:ideaId/requirements/approve",
    approveIdeaHandler(deps)
  );

  server.post(
    "/api/queen-bee/:projectId/requirements-feedback/:feedbackId/repair/start",
    repairStartHandler(deps)
  );

  server.get(
    "/api/queen-bee/:projectId/ideas/:ideaId/requirements/session",
    getIdeaSessionHandler(deps)
  );

  server.post(
    "/api/queen-bee/:projectId/cards/:cardId/requirements/start",
    startCardHandler(deps)
  );

  server.post(
    "/api/queen-bee/:projectId/cards/:cardId/requirements/respond",
    respondCardHandler(deps)
  );

  server.post(
    "/api/queen-bee/:projectId/cards/:cardId/requirements/approve",
    approveCardHandler(deps)
  );

  server.post(
    "/api/queen-bee/:projectId/requirements/start",
    startRequirementsHandler(deps)
  );

  server.post(
    "/api/queen-bee/:projectId/requirements/respond",
    respondRequirementsHandler(deps)
  );

  server.delete(
    "/api/queen-bee/:projectId/requirements/session/:sessionId",
    resetSessionHandler(deps)
  );

  server.post(
    "/api/queen-bee/:projectId/requirements/approve",
    approveRequirementsHandler(deps)
  );

  server.get("/api/queen-bee/:projectId/phase", getPhaseHandler(deps));

  server.get(
    "/api/queen-bee/:projectId/requirements",
    getRequirementsHandler(deps)
  );
}
