// The renderer corpus: representative flow specs render to TypeScript that
// passes the full correctness gate — transpile+load, the per-definition
// typecheck, and the schema-consistency check with zero errors AND zero
// warnings. This is the deterministic core of AI flow authoring: if the
// renderer corpus is green, the loop's failures come from the model's spec,
// never from the renderer's conventions.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { STRUCTURED_INTAKE_EXEMPLAR } from "./flow-authoring";
import { loadDefinitionFromSource } from "./flow-definitions";
import type { FlowSpec } from "./flow-spec";
import { validateFlowSpec } from "./flow-spec";
import { renderFlowDefinition } from "./render-flow-definition";
import { checkDefinitionSources } from "./schema-consistency";
import { typecheckDefinitionSource } from "./typecheck-definition";

// ─── gate ─────────────────────────────────────────────────────────────

async function assertRenderedPassesGate(
  spec: FlowSpec,
  slug: string
): Promise<string> {
  const specErrors = validateFlowSpec(spec);
  assert.deepEqual(
    specErrors,
    [],
    `spec validation failed for ${slug}: ${specErrors.map((e) => `${e.path}: ${e.message}`).join("; ")}`
  );

  const source = renderFlowDefinition(spec);

  // Transpile + load (the runtime surface).
  const flow = await loadDefinitionFromSource(slug, source);
  assert.ok("workflows" in flow, `${slug} loaded as a static definition`);
  if ("workflows" in flow) {
    assert.ok(flow.workflows.length >= 1, `${slug} loaded no workflows`);
  }

  // Per-definition typecheck.
  const typeIssues = typecheckDefinitionSource(source, slug);
  assert.deepEqual(
    typeIssues.map((i) => `${i.line}:${i.column} ${i.message}`),
    [],
    `${slug} does not typecheck:\n${source}`
  );

  // Schema consistency.
  const report = checkDefinitionSources([{ path: `${slug}.ts`, source }]);
  assert.deepEqual(report.errors, [], `${slug} check errors`);
  assert.deepEqual(
    report.warnings,
    [],
    `${slug} check warnings: ${report.warnings.join("; ")}`
  );

  return source;
}

// ─── the corpus ───────────────────────────────────────────────────────

describe("render flow definition", () => {
  it("renders a worktree + verify + merge card flow (engine ops, patch op, newAttempt, error counts)", async () => {
    const spec: FlowSpec = {
      id: "reviewFlow",
      label: "Review Flow",
      description: "A card lifecycle with engine-owned verification.",
      configSchema: [
        { key: "basePath", label: "Base path", type: "string", required: true },
      ],
      workflows: [
        {
          id: "cards",
          label: "Cards",
          ui: {
            view: "board",
            columns: [
              { id: "ready", label: "Ready", states: ["ready"] },
              {
                id: "active",
                label: "Active",
                states: ["running", "validating", "reviewed"],
              },
              { id: "done", label: "Done", states: ["done"] },
              { id: "dead", label: "Unfulfillable", states: ["unfulfillable"] },
            ],
          },
          instanceState: [{ field: "verdict", type: "string" }],
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
                },
                {
                  id: "recordVerdict",
                  label: "Record verdict",
                  role: "operation",
                  patch: {
                    verdict: {
                      kind: "taskOutput",
                      task: "runAgent",
                      path: "output.verdict",
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
                  to: "reviewed",
                  gate: { kind: "taskSuccess", task: "validateCompletion" },
                },
                {
                  to: "unfulfillable",
                  gate: {
                    kind: "errorCountAtLeast",
                    task: "validateCompletion",
                    count: 3,
                  },
                },
                {
                  to: "running",
                  gate: {
                    kind: "and",
                    gates: [
                      { kind: "taskError", task: "validateCompletion" },
                      {
                        kind: "not",
                        gate: {
                          kind: "errorCountAtLeast",
                          task: "validateCompletion",
                          count: 3,
                        },
                      },
                    ],
                  },
                },
              ],
            },
            {
              id: "reviewed",
              label: "Reviewed",
              category: "active",
              actions: [
                {
                  id: "accept",
                  label: "Accept work",
                  variant: "primary",
                  transitionTo: "done",
                  gate: {
                    kind: "instanceStateEquals",
                    field: "verdict",
                    value: "approved",
                  },
                },
                {
                  id: "new_changes",
                  label: "New attempt",
                  variant: "secondary",
                  transitionTo: "ready",
                  newAttempt: true,
                },
              ],
            },
            { id: "done", label: "Done", category: "terminal" },
            { id: "unfulfillable", label: "Unfulfillable", category: "error" },
          ],
        },
      ],
      edges: [],
    };

    const source = await assertRenderedPassesGate(spec, "corpus-cards");
    assert.ok(source.includes("cards_recordVerdict_patch"), "patch op emitted");
    assert.ok(
      source.includes("ctx.patchWorkflowInstanceState({"),
      "patch write emitted"
    );
    assert.ok(
      source.includes("(ctx.taskErrorCounts.validateCompletion ?? 0) >= 3"),
      "error-count gate emitted"
    );
  });

  it("renders a fan-out flow (plan → one cards instance per card)", async () => {
    const spec: FlowSpec = {
      id: "planFlow",
      label: "Plan Flow",
      configSchema: [],
      workflows: [
        {
          id: "plan",
          label: "Plan",
          instanceState: [],
          initialState: "running",
          terminalStates: ["done"],
          states: [
            {
              id: "running",
              label: "Running",
              category: "active",
              tasks: [
                {
                  id: "planWork",
                  label: "Plan",
                  role: "ai-task",
                  tools: ["read_file", "search_code"],
                  completionTool: "complete_task",
                },
              ],
              autoTransitions: [
                { to: "done", gate: { kind: "taskSuccess", task: "planWork" } },
                { to: "done", gate: { kind: "taskError", task: "planWork" } },
              ],
            },
            { id: "done", label: "Done", category: "terminal" },
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
                  id: "archive",
                  label: "Archive",
                  variant: "secondary",
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
    };

    const source = await assertRenderedPassesGate(spec, "corpus-fanout");
    assert.ok(
      source.includes('readPath(source.planWork, "output.cards")'),
      "fan-out source read emitted"
    );
    assert.ok(source.includes("items.map((item) => ({"), "fan-out map emitted");
  });

  it("renders createInstance actions (state-level and flow-level) as declared writes", async () => {
    const spec: FlowSpec = {
      id: "ideasFlow",
      label: "Ideas Flow",
      configSchema: [],
      workflows: [
        {
          id: "ideas",
          label: "Ideas",
          instance: { title: "title" },
          instanceState: [
            { field: "title", type: "string" },
            { field: "brief", type: "string" },
          ],
          initialState: "backlog",
          terminalStates: ["archived"],
          states: [
            {
              id: "backlog",
              label: "Backlog",
              category: "initial",
              actions: [
                {
                  id: "elaborate",
                  label: "Elaborate",
                  variant: "primary",
                  transitionTo: "elaborating",
                  createInstance: {
                    workflowId: "ideas",
                    fields: [
                      {
                        key: "title",
                        label: "Title",
                        type: "string",
                        required: true,
                      },
                      { key: "brief", label: "Brief", type: "string" },
                    ],
                  },
                },
              ],
            },
            {
              id: "elaborating",
              label: "Elaborating",
              category: "active",
              tasks: [
                {
                  id: "session",
                  label: "Elaborate session",
                  role: "ai-chat",
                  startOnUserInput: true,
                  completionTool: "complete_task",
                  inputFromInstanceState: "brief",
                },
              ],
              actions: [
                {
                  id: "done",
                  label: "Done",
                  variant: "primary",
                  completesRunningTask: true,
                  transitionTo: "archived",
                },
              ],
              autoTransitions: [
                {
                  to: "archived",
                  gate: { kind: "taskSuccess", task: "session" },
                },
              ],
            },
            { id: "archived", label: "Archived", category: "terminal" },
          ],
        },
      ],
      actions: [
        {
          id: "add_idea",
          label: "Add idea",
          variant: "primary",
          createInstance: {
            workflowId: "ideas",
            fields: [
              { key: "title", label: "Title", type: "string", required: true },
              { key: "brief", label: "Brief", type: "string" },
            ],
          },
        },
      ],
      edges: [],
    };

    const source = await assertRenderedPassesGate(spec, "corpus-ideas");
    assert.ok(source.includes("createInstance"), "createInstance emitted");
    assert.ok(
      source.includes("completesRunningTask: true"),
      "HITL action emitted"
    );
    assert.ok(
      source.includes('inputFromInstanceState: "brief"'),
      "state seed emitted"
    );
  });

  it("renders a minimal non-git two-state flow (no tasks, no ops)", async () => {
    const spec: FlowSpec = {
      id: "simpleFlow",
      label: "Simple Flow",
      configSchema: [
        { key: "title", label: "Title", type: "string", required: true },
      ],
      workflows: [
        {
          id: "simple",
          label: "Simple",
          instanceState: [],
          initialState: "idle",
          terminalStates: ["done"],
          states: [
            {
              id: "idle",
              label: "Idle",
              category: "initial",
              actions: [
                {
                  id: "start",
                  label: "Start",
                  variant: "primary",
                  transitionTo: "done",
                },
              ],
            },
            { id: "done", label: "Done", category: "terminal" },
          ],
        },
      ],
      edges: [],
    };

    const source = await assertRenderedPassesGate(spec, "corpus-simple");
    assert.ok(
      source.includes("workflowInstanceState: {} as Record<string, unknown>"),
      "anchor emitted"
    );
    assert.ok(
      !source.includes("defineOperations"),
      "no ops map for a task-less workflow"
    );
    assert.ok(
      !source.includes("readPath"),
      "no readPath for a task-less workflow"
    );
  });

  it("renders a structured-completion flow (completionOutput tool, patch guard, needs-review retry)", async () => {
    // The AI-generation failure mode this fixes: an ai-task that must return
    // domain data (category/tags) had no way to carry it, so the recording op
    // silently wrote nothing and the idea was marked organized anyway. With
    // completionOutput the renderer generates a per-task completion tool, the
    // parsed arguments become the output, and the patch op fails when the
    // model skipped the contract (routing to needs_review via taskError).
    const spec: FlowSpec = {
      id: "ideaOrganizer",
      label: "Idea Organizer",
      configSchema: [],
      workflows: [
        {
          id: "ideas",
          label: "Ideas",
          instance: { title: "idea" },
          display: {
            fields: [
              { path: "idea", label: "Idea" },
              { path: "category", label: "Category" },
              { path: "tags", label: "Tags" },
            ],
          },
          instanceState: [
            { field: "idea", type: "string" },
            { field: "category", type: "string" },
            { field: "tags", type: "string[]" },
          ],
          initialState: "inbox",
          terminalStates: ["organized", "discarded"],
          states: [
            {
              id: "inbox",
              label: "Inbox",
              category: "initial",
              tasks: [
                {
                  id: "organizer",
                  label: "Organize idea",
                  role: "ai-task",
                  systemPrompt:
                    "Classify the idea into a category and tags, then call the completion tool.",
                  inputFromInstanceState: "idea",
                  completionOutput: [
                    { field: "category", type: "string" },
                    { field: "tags", type: "string[]" },
                  ],
                },
                {
                  id: "record",
                  label: "Record organization",
                  role: "operation",
                  patch: {
                    category: {
                      kind: "taskOutput",
                      task: "organizer",
                      path: "output.category",
                    },
                    tags: {
                      kind: "taskOutput",
                      task: "organizer",
                      path: "output.tags",
                    },
                  },
                },
              ],
              autoTransitions: [
                {
                  to: "needs_review",
                  gate: { kind: "taskError", task: "organizer" },
                },
                {
                  to: "needs_review",
                  gate: { kind: "taskError", task: "record" },
                },
                {
                  to: "organized",
                  gate: { kind: "taskSuccess", task: "record" },
                },
              ],
            },
            {
              id: "needs_review",
              label: "Needs review",
              category: "active",
              actions: [
                {
                  id: "retry",
                  label: "Retry organization",
                  variant: "primary",
                  transitionTo: "inbox",
                },
                {
                  id: "discard",
                  label: "Discard idea",
                  variant: "destructive",
                  transitionTo: "discarded",
                },
              ],
            },
            { id: "organized", label: "Organized", category: "terminal" },
            { id: "discarded", label: "Discarded", category: "terminal" },
          ],
        },
      ],
      actions: [
        {
          id: "add_idea",
          label: "Add an idea",
          variant: "primary",
          createInstance: {
            workflowId: "ideas",
            fields: [
              {
                key: "idea",
                label: "What are you thinking about?",
                type: "string",
                required: true,
              },
            ],
          },
        },
      ],
      edges: [],
    };

    const source = await assertRenderedPassesGate(spec, "idea-organizer");
    // The completion tool is generated, offered to the model, and wired as
    // the task's completion tool.
    assert.match(source, /export const ideasCompletionTools = \[/);
    assert.match(source, /name: "ideas_organizer_complete"/);
    assert.match(source, /completionTool: "ideas_organizer_complete"/);
    assert.match(source, /tools: \["ideas_organizer_complete"\],/);
    // The task output type comes from the declared schema, and the patch op
    // verifies its sources instead of recording empty writes.
    assert.match(source, /category\?: string;/);
    assert.match(source, /tags\?: string\[\];/);
    assert.match(
      source,
      /if \(category === undefined \|\| tags === undefined\)/
    );
    assert.match(
      source,
      /organizer did not produce the declared output \(category, tags\)/
    );
  });

  it("keeps the structured-intake pattern exemplar gate-clean (the flow-authoring reference)", async () => {
    // The exemplar embedded in the generation prompt is the shape the model
    // copies — if it stops validating/rendering/typechecking cleanly, every
    // generation that copies it inherits the breakage. Guard it here.
    const source = await assertRenderedPassesGate(
      STRUCTURED_INTAKE_EXEMPLAR,
      "pattern-structured-intake"
    );
    assert.match(source, /completionTool: "items_classify_complete"/);
    assert.match(source, /tools: \["items_classify_complete"\],/);
  });

  it("renders manual-action input fields", async () => {
    const spec: FlowSpec = {
      id: "reviewFlow",
      label: "Review Flow",
      configSchema: [],
      workflows: [
        {
          id: "review",
          label: "Review",
          instance: { title: "note" },
          display: { fields: [{ path: "note", label: "Note" }] },
          instanceState: [{ field: "note", type: "string" }],
          initialState: "submitted",
          terminalStates: ["done"],
          states: [
            {
              id: "submitted",
              label: "Submitted",
              category: "initial",
              actions: [
                {
                  id: "request_correction",
                  label: "Request correction",
                  variant: "primary",
                  transitionTo: "done",
                  fields: [
                    {
                      key: "note",
                      label: "What to fix",
                      type: "string",
                      required: true,
                    },
                  ],
                },
              ],
            },
            { id: "done", label: "Done", category: "terminal" },
          ],
        },
      ],
      actions: [],
      edges: [],
    };

    const source = await assertRenderedPassesGate(spec, "corpus-fields");
    assert.match(
      source,
      /fields: \[{ key: "note", label: "What to fix", type: "string", required: true }\],/
    );
  });
});
