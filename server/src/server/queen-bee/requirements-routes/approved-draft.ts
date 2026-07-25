/** @private — only imported by register-routes.ts */

import { loadProjectContext } from "../project-context";
import type { RequirementsSessionManager } from "../requirements-session";
import { readRequirements, requirementsRevision } from "../requirements-store";

export function approvedDraft(
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
