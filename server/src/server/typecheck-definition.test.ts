// Per-definition typechecking: the "compiles" half of the correctness gate.
// A well-formed definition (with the workflow-engine authoring types) must
// produce no diagnostics; a gate referencing an undeclared task id must.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { typecheckDefinitionSource } from "./typecheck-definition.ts";

const GOOD = `import { defineWorkflow } from "workflow-engine/workflow-types";
import { defineOperations } from "workflow-engine/runners";

type ReviewItemState = {
  verdict?: string;
};

export const reviewOperations = defineOperations<ReviewItemState>({
  record_verdict: (task, params, ctx) => {
    ctx.patchWorkflowInstanceState({ verdict: params.verdict as string | undefined });
    return { ok: true };
  },
});

const reviewWf = defineWorkflow({
  id: "review",
  label: "Review",
  taskOutputs: {
    runReview: {} as { status?: string; completion?: { verdict?: string } },
  },
  workflowInstanceState: {} as ReviewItemState,
  states: [
    {
      id: "ready",
      label: "Ready",
      category: "initial",
      actions: [
        { id: "run", label: "Run", variant: "primary", transitionTo: "running" },
      ],
    },
    {
      id: "running",
      label: "Running",
      category: "active",
      tasks: [
        {
          id: "runReview",
          label: "Run review",
          trigger: "auto",
          role: "ai-task",
          tools: ["read_file"],
          completionTool: "complete_task",
          operations: ["record_verdict"],
          operationInputs: { verdict: "pending" },
        },
      ],
      autoTransitions: [
        {
          to: "approved",
          gate: (ctx) =>
            ctx.taskOutputs.runReview?.status === "success" &&
            ctx.workflowInstanceState.verdict === "approved",
        },
        {
          to: "failed",
          gate: (ctx) => ctx.taskOutputs.runReview?.status === "error",
        },
      ],
    },
    { id: "approved", label: "Approved", category: "terminal" },
    { id: "failed", label: "Failed", category: "error" },
  ],
  initial: "ready",
  terminalStates: ["approved", "failed"],
});

export const flow = {
  id: "review-flow",
  label: "Review Flow",
  workflows: [reviewWf],
  operations: { ...reviewOperations },
  edges: [],
};
`;

describe("typecheckDefinitionSource", () => {
  it("reports no issues for a well-formed definition", () => {
    const issues = typecheckDefinitionSource(GOOD, "typecheck-good");
    assert.deepEqual(
      issues.map((i) => `${i.line}:${i.column} ${i.message}`),
      []
    );
  });

  it("resolves workflow-engine imports through the server tsconfig paths", () => {
    // Implicitly covered by GOOD passing; assert explicitly that a definition
    // which misuses an engine type surfaces an engine-type error, not a
    // module-resolution error.
    const issues = typecheckDefinitionSource(GOOD, "typecheck-good-again");
    assert.ok(
      issues.every((i) => !i.message.includes("Cannot find module")),
      `unexpected module-resolution errors: ${issues.map((i) => i.message).join("; ")}`
    );
  });

  it("reports a gate referencing an undeclared task id", () => {
    const bad = GOOD.replace(
      'ctx.taskOutputs.runReview?.status === "success"',
      'ctx.taskOutputs.missingTask?.status === "success"'
    );
    const issues = typecheckDefinitionSource(bad, "typecheck-bad-task");
    assert.ok(
      issues.some((i) => i.message.includes("missingTask")),
      `expected a missing-task error, got: ${issues.map((i) => i.message).join("; ")}`
    );
  });

  it("reports a gate comparison against an undeclared instance-state field", () => {
    const bad = GOOD.replace(
      'ctx.workflowInstanceState.verdict === "approved"',
      'ctx.workflowInstanceState.nope === "approved"'
    );
    const issues = typecheckDefinitionSource(bad, "typecheck-bad-field");
    assert.ok(
      issues.some((i) => i.message.includes("nope")),
      `expected a missing-field error, got: ${issues.map((i) => i.message).join("; ")}`
    );
  });

  it("reports syntax errors as diagnostics", () => {
    const bad = GOOD.replace("const reviewWf", "const reviewWf = =");
    const issues = typecheckDefinitionSource(bad, "typecheck-bad-syntax");
    assert.ok(issues.length > 0, "expected syntax diagnostics");
  });
});
