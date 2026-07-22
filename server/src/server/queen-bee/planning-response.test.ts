import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  PlanningProposal,
  RequirementsFeedback,
} from "shared/board-types";
import { planningResponse } from "./planning-response";

describe("planningResponse", () => {
  it("wraps RequirementsFeedback with kind 'feedback'", () => {
    const feedback: RequirementsFeedback = {
      kind: "requirements_feedback",
      id: "fb-1",
      projectId: "p-1",
      status: "pending",
      projectRevision: null,
      baseRequirementsRevision: "r1",
      baseBoardRevision: "b1",
      proposedRequirements: "# Draft",
      createdAt: "2026-01-01T00:00:00.000Z",
      issues: [],
    };

    assert.deepEqual(planningResponse(feedback), {
      kind: "feedback" as const,
      feedback,
    });
  });

  it("wraps PlanningProposal with kind 'proposal'", () => {
    const proposal: PlanningProposal = {
      id: "pp-1",
      projectId: "p-1",
      status: "pending",
      baseRequirementsRevision: "r1",
      baseBoardRevision: "b1",
      projectRevision: null,
      runKind: "initial_planning",
      proposedRequirements: "# Draft",
      changes: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    assert.deepEqual(planningResponse(proposal), {
      kind: "proposal" as const,
      proposal,
    });
  });
});
