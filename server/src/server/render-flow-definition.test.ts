// The renderer corpus: representative flow specs render to TypeScript that
// passes the full correctness gate — transpile+load, the per-definition
// typecheck, and the schema-consistency check with zero errors AND zero
// warnings. This is the deterministic core of AI flow authoring: if the
// renderer corpus is green, the loop's failures come from the model's spec,
// never from the renderer's conventions.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { STRUCTURED_INTAKE_EXEMPLAR } from "./flow-authoring.ts";
import type { FlowBlueprint } from "./flow-blueprint.ts";
import { validateFlowBlueprint } from "./flow-blueprint.ts";
import { loadDefinitionFromSource } from "./flow-definitions.ts";
import {
  lintModuleSet,
  loadModuleSetDefinition,
  materializeModuleSet,
} from "./module-set.ts";
import { parseFlowDefinition } from "./parse-flow-definition.ts";
import { renderFlowDefinition } from "./render-flow-definition.ts";
import { checkDefinitionSources } from "./schema-consistency.ts";
import { typecheckDefinitionSource } from "./typecheck-definition.ts";

// ─── gate ─────────────────────────────────────────────────────────────

async function assertRenderedPassesGate(
  spec: FlowBlueprint,
  slug: string
): Promise<string> {
  const specErrors = validateFlowBlueprint(spec);
  assert.deepEqual(
    specErrors,
    [],
    `spec validation failed for ${slug}: ${specErrors.map((e) => `${e.path}: ${e.message}`).join("; ")}`
  );

  const source = renderFlowDefinition(spec).entry;

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

  // The reverse renderer round-trips the emission: parse the rendered entry
  // back into the blueprint, validate it clean, and re-render byte-identical
  // (the parse is the renderer's mirror — a corpus spec that stops
  // round-tripping fails loudly here).
  const parsed = parseFlowDefinition(source, renderedFiles(spec));
  assert.deepEqual(
    parsed.findings,
    [],
    `${slug} parse findings: ${parsed.findings.join("; ")}`
  );
  const parsedErrors = validateFlowBlueprint(parsed.blueprint);
  assert.deepEqual(
    parsedErrors,
    [],
    `${slug} parsed blueprint validation: ${parsedErrors.map((e) => `${e.path}: ${e.message}`).join("; ")}`
  );
  const reRendered = renderFlowDefinition(parsed.blueprint).entry;
  assert.equal(reRendered, source, `${slug} must round-trip byte-identically`);

  return source;
}

// The files map a corpus round-trip parses with: the rendered stubs (the
// session passes its current files; a corpus spec's stubs are its files).
function renderedFiles(spec: FlowBlueprint): Record<string, string> {
  return renderFlowDefinition(spec).files;
}

// ─── the corpus ───────────────────────────────────────────────────────

describe("render flow definition", () => {
  it("renders a worktree + verify + merge card flow (engine ops, patch op, newAttempt, error counts)", async () => {
    const spec: FlowBlueprint = {
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
    const spec: FlowBlueprint = {
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
    const spec: FlowBlueprint = {
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
    const spec: FlowBlueprint = {
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
    const spec: FlowBlueprint = {
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

  it("renders an ai-chat completion contract (completionOutput on ai-chat, output.completion reads)", async () => {
    // The queen-bee worker shape: a multi-turn ai-chat whose completion tool
    // carries the structured outcome; gates branch on output.completion.<field>.
    const spec: FlowBlueprint = {
      id: "workerFlow",
      label: "Worker Flow",
      configSchema: [],
      workflows: [
        {
          id: "cards",
          label: "Cards",
          display: { fields: [{ path: "outcome", label: "Outcome" }] },
          instanceState: [{ field: "outcome", type: "string" }],
          initialState: "running",
          terminalStates: ["reviewed", "unfulfillable"],
          states: [
            {
              id: "running",
              label: "Running",
              category: "initial",
              tasks: [
                {
                  id: "runAgent",
                  label: "Run worker",
                  role: "ai-chat",
                  systemPrompt:
                    "Implement the card, then call cards_runAgent_complete with the outcome.",
                  startOnUserInput: true,
                  completionOutput: [
                    { field: "outcome", type: "string" },
                    { field: "summary", type: "string" },
                  ],
                },
                {
                  id: "record",
                  label: "Record outcome",
                  role: "operation",
                  patch: {
                    outcome: {
                      kind: "taskOutput",
                      task: "runAgent",
                      path: "output.completion.outcome",
                    },
                  },
                },
              ],
              autoTransitions: [
                {
                  to: "reviewed",
                  gate: {
                    kind: "taskOutputEquals",
                    task: "runAgent",
                    path: "output.completion.outcome",
                    value: "implemented",
                  },
                },
                {
                  to: "unfulfillable",
                  gate: { kind: "taskError", task: "runAgent" },
                },
              ],
            },
            { id: "reviewed", label: "Reviewed", category: "terminal" },
            { id: "unfulfillable", label: "Unfulfillable", category: "error" },
          ],
        },
      ],
      actions: [],
      edges: [],
    };

    const source = await assertRenderedPassesGate(spec, "corpus-worker");
    assert.match(source, /export const cardsCompletionTools = \[/);
    assert.match(source, /name: "cards_runAgent_complete"/);
    assert.match(source, /completionTool: "cards_runAgent_complete"/);
    // The ai-chat output type wraps the fields under `completion`.
    assert.match(
      source,
      /completion\?: \{ outcome\?: string; summary\?: string; \}/
    );
    // The patch op reads through the wrapper and the gate compares it.
    assert.match(
      source,
      /readPath\(ctx\.taskOutputs\(\)\.runAgent, "output\.completion\.outcome"\)/
    );
    assert.match(
      source,
      /ctx\.taskOutputs\.runAgent\?\.output\?\.completion\?\.outcome === "implemented"/
    );
  });

  it("renders ui.components and a workflow instanceComponent, and the served source resolves", async () => {
    const componentSource =
      "export default function (lit) { return { components: {} }; }";
    const spec: FlowBlueprint = {
      id: "servedFlow",
      label: "Served Flow",
      configSchema: [],
      ui: { components: { "idea-card": componentSource } },
      workflows: [
        {
          id: "ideas",
          label: "Ideas",
          instance: { title: "title" },
          ui: { view: "list", instanceComponent: "idea-card" },
          instanceState: [{ field: "title", type: "string" }],
          initialState: "backlog",
          terminalStates: ["archived"],
          states: [
            {
              id: "backlog",
              label: "Backlog",
              category: "initial",
              actions: [
                { id: "archive", label: "Archive", transitionTo: "archived" },
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
              {
                key: "title",
                label: "Title",
                type: "string",
                required: true,
              },
            ],
          },
        },
      ],
      edges: [],
    };

    const source = await assertRenderedPassesGate(spec, "corpus-served");
    assert.match(source, /instanceComponent: "idea-card"/);
    assert.match(
      source,
      /ui: \{ components: \{ "idea-card": "export default function \(lit\) \{ return \{ components: \{\} \}; \}" \} \},/
    );

    // The loaded definition carries the served component; the server's
    // served-component resolver reads it back.
    const flow = await loadDefinitionFromSource("corpus-served-load", source);
    assert.equal(flow.ui?.components?.["idea-card"], componentSource);
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
    const spec: FlowBlueprint = {
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

  it("renders richer configSchema field types with placeholder and defaultValue", async () => {
    const spec: FlowBlueprint = {
      id: "richFlow",
      label: "Rich Flow",
      configSchema: [
        { key: "note", label: "Note", type: "textarea" },
        {
          key: "tags",
          label: "Tags",
          type: "string[]",
          options: ["a", "b"],
          placeholder: "Pick tags",
          defaultValue: ["a"],
        },
        { key: "due", label: "Due", type: "date", required: true },
      ],
      workflows: [
        {
          id: "rich",
          label: "Rich",
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
                  id: "work",
                  label: "Work",
                  role: "ai-task",
                  completionTool: "complete_task",
                },
              ],
              autoTransitions: [
                { to: "done", gate: { kind: "taskSuccess", task: "work" } },
              ],
            },
            { id: "done", label: "Done", category: "terminal" },
          ],
        },
      ],
      actions: [],
      edges: [],
    };

    const source = await assertRenderedPassesGate(spec, "corpus-rich-fields");
    assert.match(source, /type: "textarea"/);
    assert.match(source, /type: "string\[\]"/);
    assert.match(source, /type: "date", required: true/);
    assert.match(source, /placeholder: "Pick tags"/);
    assert.match(source, /defaultValue: \["a"\]/);
  });

  it("renders editFields on a workflow", async () => {
    const spec: FlowBlueprint = {
      id: "editFlow",
      label: "Edit Flow",
      configSchema: [],
      workflows: [
        {
          id: "ticket",
          label: "Ticket",
          instance: { title: "title" },
          instanceState: [{ field: "title", type: "string" }],
          editFields: [
            { key: "title", label: "Title", type: "string", required: true },
          ],
          initialState: "open",
          terminalStates: ["closed"],
          states: [
            {
              id: "open",
              label: "Open",
              category: "initial",
              actions: [
                { id: "close", label: "Close", transitionTo: "closed" },
              ],
            },
            { id: "closed", label: "Closed", category: "terminal" },
          ],
        },
      ],
      actions: [],
      edges: [],
    };

    const source = await assertRenderedPassesGate(spec, "corpus-edit-fields");
    assert.match(
      source,
      /editFields: \[{ key: "title", label: "Title", type: "string", required: true }\],/
    );
  });

  it("renders confirmText on a manual action", async () => {
    const spec: FlowBlueprint = {
      id: "confirmFlow",
      label: "Confirm Flow",
      configSchema: [],
      workflows: [
        {
          id: "review",
          label: "Review",
          instanceState: [],
          initialState: "ready",
          terminalStates: ["done"],
          states: [
            {
              id: "ready",
              label: "Ready",
              category: "initial",
              actions: [
                {
                  id: "purge",
                  label: "Purge",
                  variant: "destructive",
                  confirmText: "Delete everything?",
                  transitionTo: "done",
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

    const source = await assertRenderedPassesGate(spec, "corpus-confirm-text");
    assert.match(source, /confirmText: "Delete everything\?",/);
  });

  it("normalizes a bare-string render hint to { kind: ... } in the entry", async () => {
    const spec: FlowBlueprint = {
      id: "renderFlow",
      label: "Render Flow",
      configSchema: [],
      workflows: [
        {
          id: "board",
          label: "Board",
          instanceState: [{ field: "note", type: "string" }],
          editFields: [{ key: "note", label: "Note", type: "string" }],
          display: {
            fields: [
              { path: "note", label: "Note", render: "markdown" as never },
            ],
          },
          initialState: "ready",
          terminalStates: ["done"],
          states: [
            {
              id: "ready",
              label: "Ready",
              category: "initial",
              actions: [
                { id: "finish", label: "Finish", transitionTo: "done" },
              ],
            },
            { id: "done", label: "Done", category: "terminal" },
          ],
        },
      ],
      actions: [],
      edges: [],
    };

    const source = await assertRenderedPassesGate(spec, "corpus-render");
    assert.match(source, /render: \{"kind":"markdown"\}/);
  });

  it("renders a derived display field", async () => {
    const spec: FlowBlueprint = {
      id: "deriveFlow",
      label: "Derive Flow",
      configSchema: [],
      workflows: [
        {
          id: "board",
          label: "Board",
          instanceState: [{ field: "items", type: "object[]" }],
          editFields: [{ key: "items", label: "Items", type: "string[]" }],
          display: {
            fields: [
              {
                path: "items",
                label: "Done",
                derive: {
                  kind: "progress",
                  where: { field: "status", equals: "done" },
                },
              },
            ],
          },
          initialState: "ready",
          terminalStates: ["done"],
          states: [
            {
              id: "ready",
              label: "Ready",
              category: "initial",
              actions: [
                { id: "finish", label: "Finish", transitionTo: "done" },
              ],
            },
            { id: "done", label: "Done", category: "terminal" },
          ],
        },
      ],
      actions: [],
      edges: [],
    };

    const source = await assertRenderedPassesGate(
      spec,
      "corpus-derive-display"
    );
    assert.match(
      source,
      /derive: \{"kind":"progress","where":\{"field":"status","equals":"done"\}\}/
    );
  });

  describe("module-set rendering (blueprint-referenced modules)", () => {
    // A blueprint exercising all five reference kinds end to end: a gate file
    // ref on a transition, a custom tool an agent task calls, flow-level +
    // inline operation refs, an edge transform ref, and an output extractor.
    const REFS: FlowBlueprint = {
      id: "moduleSetFlow",
      label: "Module Set Flow",
      configSchema: [],
      tools: [{ id: "websearch", ref: "./tools/websearch.ts" }],
      operations: [{ id: "score", ref: "./ops/score.ts" }],
      workflows: [
        {
          id: "research",
          label: "Research",
          instance: { title: "query" },
          display: {
            fields: [
              { path: "query", label: "Query" },
              { path: "result", label: "Result" },
              { path: "score", label: "Score" },
              { path: "verdict", label: "Verdict" },
            ],
          },
          instanceState: [
            { field: "query", type: "string" },
            { field: "result", type: "string" },
            { field: "score", type: "number" },
            { field: "verdict", type: "string" },
          ],
          initialState: "searching",
          terminalStates: ["done"],
          states: [
            {
              id: "searching",
              label: "Searching",
              category: "initial",
              tasks: [
                {
                  id: "search",
                  label: "Search the web",
                  role: "ai-chat",
                  systemPrompt:
                    "Search for the query, report the top result, then call the completion tool.",
                  tools: ["websearch"],
                  completionTool: "complete_task",
                  inputFromInstanceState: "query",
                },
                {
                  id: "scoreResult",
                  label: "Score the result",
                  role: "operation",
                  operations: ["score", { ref: "./ops/annotate.ts" }],
                },
                {
                  id: "recordScore",
                  label: "Record the score",
                  role: "operation",
                  patch: {
                    score: {
                      kind: "taskOutput",
                      task: "scoreResult",
                      path: "output.score",
                    },
                    result: {
                      kind: "taskOutput",
                      task: "search",
                      path: "output.completion.summary",
                    },
                  },
                },
              ],
              autoTransitions: [
                {
                  to: "extracting",
                  gate: { kind: "taskSuccess", task: "recordScore" },
                },
                {
                  to: "needs_review",
                  gate: { kind: "taskError", task: "recordScore" },
                },
              ],
            },
            {
              id: "extracting",
              label: "Extracting",
              category: "active",
              tasks: [
                {
                  id: "extractResult",
                  label: "Extract the verdict",
                  role: "operation",
                  extract: {
                    ref: "./extractors/parse-result.ts",
                    fields: ["verdict"],
                  },
                },
              ],
              autoTransitions: [
                {
                  to: "done",
                  gate: { kind: "file", ref: "./gates/approved.ts" },
                },
                { to: "needs_review", gate: { kind: "always" } },
              ],
            },
            {
              id: "needs_review",
              label: "Needs review",
              category: "active",
              actions: [
                {
                  id: "retry",
                  label: "Retry",
                  variant: "primary",
                  transitionTo: "extracting",
                  gate: {
                    kind: "instanceStateEquals",
                    field: "verdict",
                    value: "approved",
                  },
                },
              ],
            },
            { id: "done", label: "Done", category: "terminal" },
          ],
        },
        {
          id: "summary",
          label: "Summary",
          instance: { title: "title" },
          display: { fields: [{ path: "body", label: "Body" }] },
          instanceState: [
            { field: "title", type: "string" },
            { field: "body", type: "string" },
          ],
          initialState: "ready",
          terminalStates: ["ready"],
          states: [{ id: "ready", label: "Ready", category: "initial" }],
        },
      ],
      edges: [
        {
          fromWorkflow: "research",
          fromStates: ["done"],
          toWorkflow: "summary",
          transform: {
            ref: "./edges/to-summary.ts",
            fields: ["title", "body"],
          },
        },
      ],
      actions: [
        {
          id: "add_research",
          label: "Add research",
          variant: "primary",
          createInstance: {
            workflowId: "research",
            fields: [
              {
                key: "query",
                label: "Query",
                type: "string",
                required: true,
              },
            ],
          },
        },
      ],
    };

    it("renders the entry with the references wired via imports", async () => {
      const rendered = renderFlowDefinition(REFS);
      const entry = rendered.entry;
      assert.match(
        entry,
        /import \{ approved \} from "\.\/gates\/approved\.ts";/
      );
      assert.match(
        entry,
        /import \{ websearchTools \} from "\.\/tools\/websearch\.ts";/
      );
      assert.match(
        entry,
        /import \{ scoreOperations \} from "\.\/ops\/score\.ts";/
      );
      assert.match(
        entry,
        /import \{ annotateOperations \} from "\.\/ops\/annotate\.ts";/
      );
      assert.match(
        entry,
        /import \{ toSummary \} from "\.\/edges\/to-summary\.ts";/
      );
      assert.match(
        entry,
        /import \{ parseResult \} from "\.\/extractors\/parse-result\.ts";/
      );
      // The gate reference is called with the runtime context.
      assert.match(entry, /gate: \(ctx\) => approved\(ctx\),/);
      // The ops maps and tool list are merged into the flow.
      assert.match(entry, /\.\.\.scoreOperations/);
      assert.match(entry, /\.\.\.annotateOperations/);
      assert.match(entry, /\.\.\.researchOperations/);
      assert.match(entry, /tools: \[\.\.\.websearchTools/);
      // The extract op runs the imported extractor and patches the declared
      // fields as literal keys.
      assert.match(entry, /const extracted = parseResult\(\{/);
      assert.match(entry, /verdict: extracted\.verdict/);
      // The ref transform is wrapped so its writes stay visible to the
      // schema-consistency check.
      assert.match(entry, /const out = toSummary\(source\);/);
      assert.match(entry, /row\.title/);
      assert.match(entry, /row\.body/);
    });

    it("emits one contract-typed stub per reference", () => {
      const rendered = renderFlowDefinition(REFS);
      assert.deepEqual(
        Object.keys(rendered.files).sort(),
        [
          "./edges/to-summary.ts",
          "./extractors/parse-result.ts",
          "./gates/approved.ts",
          "./ops/annotate.ts",
          "./ops/score.ts",
          "./tools/websearch.ts",
        ].sort()
      );
      const gateStub = rendered.files["./gates/approved.ts"];
      assert.match(gateStub, /GateContract/);
      assert.match(gateStub, /export const approved/);
      const toolStub = rendered.files["./tools/websearch.ts"];
      assert.match(toolStub, /defineTool/);
      assert.match(toolStub, /name: "websearch"/);
      const opStub = rendered.files["./ops/score.ts"];
      assert.match(opStub, /defineOperations/);
      assert.match(opStub, /score:/);
      const transformStub = rendered.files["./edges/to-summary.ts"];
      assert.match(transformStub, /TransformContract/);
      assert.match(transformStub, /export const toSummary/);
      const extractStub = rendered.files["./extractors/parse-result.ts"];
      assert.match(extractStub, /OutputExtractor/);
      assert.match(extractStub, /export const parseResult/);
    });

    it("keeps the no-reference corpus output unchanged", async () => {
      const plain = renderFlowDefinition(STRUCTURED_INTAKE_EXEMPLAR);
      assert.deepEqual(Object.keys(plain.files), []);
      assert.match(plain.entry, /export const flow = \{/);
      const source = await assertRenderedPassesGate(
        STRUCTURED_INTAKE_EXEMPLAR,
        "module-set-plain"
      );
      assert.match(source, /completionTool: "items_classify_complete"/);
    });
  });

  it("renders a referenced system prompt (systemPromptRef imports the prompt const)", async () => {
    const spec: FlowBlueprint = {
      id: "promptFlow",
      label: "Prompt Flow",
      configSchema: [],
      workflows: [
        {
          id: "research",
          label: "Research",
          instanceState: [{ field: "query", type: "string" }],
          initialState: "searching",
          terminalStates: ["done"],
          states: [
            {
              id: "searching",
              label: "Searching",
              category: "initial",
              tasks: [
                {
                  id: "search",
                  label: "Search",
                  role: "ai-task",
                  completionTool: "complete_task",
                  systemPromptRef: "./prompts/worker.ts",
                },
              ],
              autoTransitions: [
                { to: "done", gate: { kind: "taskSuccess", task: "search" } },
              ],
            },
            { id: "done", label: "Done", category: "terminal" },
          ],
        },
      ],
      actions: [],
      edges: [],
    };

    const rendered = renderFlowDefinition(spec);
    assert.match(
      rendered.entry,
      /import \{ worker \} from "\.\/prompts\/worker\.ts";/
    );
    assert.match(rendered.entry, /systemPrompt: worker,/);
    const stub = rendered.files["./prompts/worker.ts"];
    assert.match(stub, /export const worker = /);

    // The prompt file is part of the module set: writing an implementation and
    // running the gate stays clean.
    rendered.files["./prompts/worker.ts"] =
      'export const worker = "You are the Research Agent. Complete the search.";\n';
    const dir = materializeModuleSet("prompt-flow", rendered);
    const findings = lintModuleSet(spec, dir);
    assert.deepEqual(findings, []);
    const flow = await loadModuleSetDefinition(dir);
    if (!("workflows" in flow)) {
      throw new Error("expected a static definition");
    }
    const task = flow.workflows[0]?.states?.[0]?.tasks?.[0];
    assert.equal(
      task?.systemPrompt,
      "You are the Research Agent. Complete the search."
    );
  });
});
