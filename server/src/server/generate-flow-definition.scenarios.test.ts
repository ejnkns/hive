// Generation scenarios: each pattern in the flow-authoring knowledge, driven
// end to end through the loop with a stubbed model caller. A scenario passes
// when the loop reports zero errors AND zero warnings — i.e. the model's spec
// for that pattern validates, renders, loads, typechecks, and is structurally
// sound. This is the regression surface for the skill: if a pattern stops
// generating cleanly, generation quality broke with it.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { STRUCTURED_INTAKE_EXEMPLAR } from "./flow-authoring.ts";
import type { FlowSpec } from "./flow-spec.ts";
import {
  type ModelCaller,
  runGenerationLoop,
} from "./generate-flow-definition.ts";

// The stub: call 1 answers the design stage, call 2 returns the scenario's
// spec. A clean spec passes on spec attempt 1.
function modelReturning(spec: FlowSpec): ModelCaller {
  let calls = 0;
  return async () => {
    calls++;
    return calls === 1
      ? "Design: the flow described by the request."
      : `\`\`\`json\n${JSON.stringify(spec)}\n\`\`\``;
  };
}

async function assertScenarioPasses(
  request: string,
  spec: FlowSpec,
  assertions: (source: string) => void
): Promise<void> {
  const result = await runGenerationLoop(request, modelReturning(spec));
  assert.equal(result.report.passed, true, request);
  assert.deepEqual(
    result.report.errors,
    [],
    `${request} errors: ${result.report.errors.join("; ")}`
  );
  assert.deepEqual(
    result.report.warnings,
    [],
    `${request} warnings: ${result.report.warnings.join("; ")}`
  );
  assertions(result.source);
}

// A proposal a human approves or rejects: ai-chat HITL session, a Done action
// completing it, approve/reject verdicts.
const HUMAN_REVIEW_SPEC: FlowSpec = {
  id: "proposalReview",
  label: "Proposal Review",
  configSchema: [],
  workflows: [
    {
      id: "review",
      label: "Review",
      instance: { title: "title" },
      display: { fields: [{ path: "title", label: "Title" }] },
      instanceState: [{ field: "title", type: "string" }],
      initialState: "ready",
      terminalStates: ["approved", "rejected"],
      states: [
        {
          id: "ready",
          label: "Ready",
          category: "initial",
          actions: [
            {
              id: "start",
              label: "Start review",
              variant: "primary",
              transitionTo: "running",
            },
          ],
        },
        {
          id: "running",
          label: "Running",
          category: "active",
          tasks: [
            {
              id: "session",
              label: "Review session",
              role: "ai-chat",
              systemPrompt:
                "Work with the reviewer to refine the proposal; end when they finish the session.",
              startOnUserInput: true,
              inputFromInstanceState: "title",
            },
          ],
          actions: [
            {
              id: "done",
              label: "Finish session",
              variant: "primary",
              completesRunningTask: true,
              transitionTo: "reviewed",
            },
          ],
        },
        {
          id: "reviewed",
          label: "Reviewed",
          category: "active",
          actions: [
            {
              id: "approve",
              label: "Approve",
              variant: "primary",
              transitionTo: "approved",
            },
            {
              id: "reject",
              label: "Reject",
              variant: "destructive",
              transitionTo: "rejected",
            },
          ],
        },
        { id: "approved", label: "Approved", category: "terminal" },
        { id: "rejected", label: "Rejected", category: "terminal" },
      ],
    },
  ],
  actions: [
    {
      id: "add",
      label: "Add proposal",
      variant: "primary",
      createInstance: {
        workflowId: "review",
        fields: [
          { key: "title", label: "Title", type: "string", required: true },
        ],
      },
    },
  ],
  edges: [],
};

// A plan workflow whose ai-task returns a card list, fanned out into card
// instances via an edge — exercises the object[] completionOutput type.
const PIPELINE_FANOUT_SPEC: FlowSpec = {
  id: "planning",
  label: "Planning",
  configSchema: [],
  workflows: [
    {
      id: "plan",
      label: "Plan",
      instance: { title: "goal" },
      instanceState: [{ field: "goal", type: "string" }],
      initialState: "running",
      terminalStates: ["done", "failed"],
      states: [
        {
          id: "running",
          label: "Running",
          category: "initial",
          tasks: [
            {
              id: "planWork",
              label: "Plan work",
              role: "ai-task",
              systemPrompt:
                "Break the goal into concrete cards and call the completion tool with them.",
              inputFromInstanceState: "goal",
              completionOutput: [
                {
                  field: "cards",
                  type: "object[]",
                  description: "one entry per card: { title, dependencies }",
                },
              ],
            },
          ],
          autoTransitions: [
            { to: "done", gate: { kind: "taskSuccess", task: "planWork" } },
            { to: "failed", gate: { kind: "taskError", task: "planWork" } },
          ],
        },
        { id: "done", label: "Done", category: "terminal" },
        { id: "failed", label: "Failed", category: "terminal" },
      ],
    },
    {
      id: "cards",
      label: "Cards",
      instance: { title: "title" },
      instanceState: [
        { field: "title", type: "string" },
        { field: "dependsOn", type: "string[]" },
      ],
      initialState: "ready",
      terminalStates: ["done"],
      states: [
        {
          id: "ready",
          label: "Ready",
          category: "initial",
          actions: [
            {
              id: "complete",
              label: "Mark done",
              variant: "primary",
              transitionTo: "done",
            },
          ],
        },
        { id: "done", label: "Done", category: "terminal" },
      ],
    },
  ],
  edges: [
    {
      fromWorkflow: "plan",
      fromStates: ["done"],
      toWorkflow: "cards",
      fanOut: {
        task: "planWork",
        path: "output.cards",
        fields: {
          title: { kind: "itemPath", path: "title" },
          dependsOn: { kind: "itemPath", path: "dependencies" },
        },
      },
    },
  ],
  actions: [
    {
      id: "add_goal",
      label: "Add a goal",
      variant: "primary",
      createInstance: {
        workflowId: "plan",
        fields: [
          { key: "goal", label: "Goal", type: "string", required: true },
        ],
      },
    },
  ],
};

// A repo-backed card lifecycle: worktree, worker with git tools, committed-work
// verification, and an acceptance merge.
const GIT_WORK_SPEC: FlowSpec = {
  id: "repoWork",
  label: "Repo Work",
  configSchema: [
    { key: "basePath", label: "Base path", type: "string", required: true },
  ],
  workflows: [
    {
      id: "cards",
      label: "Cards",
      instance: { title: "cardSpec" },
      display: {
        fields: [
          { path: "cardSpec", label: "Card spec" },
          { path: "verdict", label: "Verdict" },
        ],
      },
      instanceState: [
        { field: "cardSpec", type: "string" },
        { field: "verdict", type: "string" },
      ],
      initialState: "ready",
      terminalStates: ["done", "unfulfillable"],
      states: [
        {
          id: "ready",
          label: "Ready",
          category: "initial",
          actions: [
            {
              id: "run",
              label: "Run Worker",
              variant: "primary",
              transitionTo: "running",
              gate: { kind: "noRunningTask" },
            },
          ],
        },
        {
          id: "running",
          label: "Running",
          category: "active",
          tasks: [
            {
              id: "prepareWorktree",
              label: "Prepare worktree",
              role: "operation",
              operations: ["prepare_worktree"],
            },
            {
              id: "runAgent",
              label: "Run worker agent",
              role: "ai-task",
              systemPrompt:
                "Implement the card spec in the workspace, commit the work, then complete the task.",
              tools: [
                "read_file",
                "write_file",
                "run_command",
                "git_status",
                "git_diff",
                "git_log",
                "commit_work",
              ],
              completionTool: "complete_task",
              workspacePath: "@instance:worktreePath",
              inputFromInstanceState: "cardSpec",
            },
            {
              id: "recordVerdict",
              label: "Record verdict",
              role: "operation",
              patch: {
                verdict: {
                  kind: "taskOutput",
                  task: "runAgent",
                  path: "output.outcome",
                },
              },
            },
          ],
          autoTransitions: [
            {
              to: "validating",
              gate: { kind: "taskSuccess", task: "recordVerdict" },
            },
            {
              to: "unfulfillable",
              gate: { kind: "taskError", task: "runAgent" },
            },
          ],
        },
        {
          id: "validating",
          label: "Validating",
          category: "active",
          tasks: [
            {
              id: "validateCompletion",
              label: "Validate completion",
              role: "operation",
              operations: ["verify_workspace"],
              operationInputs: { require: "committed" },
            },
          ],
          autoTransitions: [
            {
              to: "reviewing",
              gate: { kind: "taskSuccess", task: "validateCompletion" },
            },
            {
              to: "unfulfillable",
              gate: { kind: "taskError", task: "validateCompletion" },
            },
          ],
        },
        {
          id: "reviewing",
          label: "Reviewing",
          category: "active",
          actions: [
            {
              id: "accept",
              label: "Accept",
              variant: "primary",
              transitionTo: "accepting",
            },
            {
              id: "reject",
              label: "Reject",
              variant: "destructive",
              transitionTo: "unfulfillable",
            },
          ],
        },
        {
          id: "accepting",
          label: "Accepting",
          category: "active",
          tasks: [
            {
              id: "mergeWork",
              label: "Merge work",
              role: "operation",
              operations: ["merge_branch"],
            },
          ],
          autoTransitions: [
            { to: "done", gate: { kind: "taskSuccess", task: "mergeWork" } },
            {
              to: "reviewing",
              gate: { kind: "taskError", task: "mergeWork" },
            },
          ],
        },
        { id: "done", label: "Done", category: "terminal" },
        { id: "unfulfillable", label: "Unfulfillable", category: "terminal" },
      ],
    },
  ],
  actions: [
    {
      id: "add",
      label: "Add card",
      variant: "primary",
      createInstance: {
        workflowId: "cards",
        fields: [
          {
            key: "cardSpec",
            label: "Card spec",
            type: "string",
            required: true,
          },
        ],
      },
    },
  ],
  edges: [],
};

describe("generation scenarios (the skill's regression surface)", () => {
  it("structured intake: items classified into categories and tags", async () => {
    await assertScenarioPasses(
      "Classify incoming items into a category and tags automatically",
      STRUCTURED_INTAKE_EXEMPLAR,
      (source) => {
        assert.match(source, /completionTool: "items_classify_complete"/);
        assert.match(source, /tools: \["items_classify_complete"\],/);
        assert.match(source, /category === undefined \|\| tags === undefined/);
        assert.match(source, /to: "needs_review"/);
      }
    );
  });

  it("human review: a proposal a human approves or rejects", async () => {
    await assertScenarioPasses(
      "A flow where a human reviews each proposal and approves or rejects it",
      HUMAN_REVIEW_SPEC,
      (source) => {
        assert.match(source, /startOnUserInput: true/);
        assert.match(source, /completesRunningTask: true/);
        assert.match(source, /"approve"/);
        assert.match(source, /"reject"/);
      }
    );
  });

  it("pipeline fan-out: one plan creates one card per item", async () => {
    await assertScenarioPasses(
      "Plan the work, then create one card per planned item",
      PIPELINE_FANOUT_SPEC,
      (source) => {
        assert.match(source, /items: \{ type: "object" \}/);
        assert.match(source, /readPath\(source\.planWork, "output\.cards"\)/);
        assert.match(source, /items\.map\(\(item\)/);
        assert.match(source, /dependsOn: readPath\(item, "dependencies"\)/);
      }
    );
  });

  it("git-backed work: a worker implements a card and the flow verifies and merges it", async () => {
    await assertScenarioPasses(
      "A repo task lifecycle where a worker implements a card, the work is verified committed, and accepted work merges",
      GIT_WORK_SPEC,
      (source) => {
        assert.match(source, /prepare_worktree/);
        assert.match(source, /verify_workspace/);
        assert.match(source, /merge_branch/);
        assert.match(source, /workspacePath: "@instance:worktreePath"/);
      }
    );
  });
});
