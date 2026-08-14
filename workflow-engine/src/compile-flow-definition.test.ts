// The compile step: a pure-data FlowDefinition → the runtime projection.
// These tests assert the compiled shape (closures for gates/transforms, ops
// and tools by name) and that a compiled definition runs in a real
// FlowRuntime with the engine's operation runner — the "compiles clean, runs
// clean" half of the corpus oracle (validation lives server-side).

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectDefinitionRefs,
  compileFlowDefinition,
  type RefResolver,
} from "./compile-flow-definition.ts";
import { createFlowRuntime } from "./create-flow-runtime.ts";
import { createOperationRunner } from "./runners/create-operation-runner.ts";
import type { TaskRunnerContext } from "./task-runner.ts";
import type {
  CompiledFlowDefinition,
  FlowDefinition,
  TaskOutputMap,
} from "./workflow-types.ts";

// ─── fixtures ─────────────────────────────────────────────────────────

// The review flow the authoring session converges on (mock-provider's
// AUTHORING_SPEC as data): flow-level createInstance, state actions, a
// referenced tool list.
const reviewFlow: FlowDefinition = {
  id: "reviewFlow",
  label: "Review Flow",
  description: "A review flow with a ready state and approve/reject actions.",
  configSchema: [],
  tools: [{ id: "websearch", ref: "./tools/websearch.ts" }],
  workflows: [
    {
      id: "items",
      label: "Items",
      instance: { title: "title" },
      display: { fields: [{ path: "title", label: "Title" }] },
      instanceState: [{ field: "title", type: "string" }],
      initial: "new",
      terminalStates: ["done"],
      states: [
        {
          id: "new",
          label: "New",
          category: "initial",
          actions: [
            {
              id: "complete",
              label: "Complete",
              variant: "primary",
              transitionTo: "done",
            },
            {
              id: "reject",
              label: "Reject",
              variant: "destructive",
              transitionTo: "done",
            },
          ],
        },
        { id: "done", label: "Done", category: "terminal" },
      ],
    },
  ],
  actions: [
    {
      id: "add_item",
      label: "Add an item",
      variant: "primary",
      createInstance: {
        workflowId: "items",
        fields: [
          { key: "title", label: "Title", type: "string", required: true },
        ],
      },
    },
  ],
  edges: [],
};

// The research-loop flow (ticket 4): a custom gate file ref, a custom tool,
// and an output extractor, plus a completion contract on an ai-chat.
const researchFlow: FlowDefinition = {
  id: "researchLoop",
  label: "Research Loop",
  configSchema: [],
  tools: [{ id: "websearch", ref: "./tools/websearch.ts" }],
  workflows: [
    {
      id: "research",
      label: "Research",
      instance: { title: "query" },
      display: {
        fields: [
          { path: "query", label: "Query" },
          { path: "verdict", label: "Verdict" },
        ],
      },
      instanceState: [
        { field: "query", type: "string" },
        { field: "verdict", type: "string" },
      ],
      initial: "searching",
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
              systemPrompt: "You are the Research Agent.",
              tools: ["websearch"],
              startOnUserInput: true,
              inputFromInstanceState: "query",
              completionOutput: [
                { field: "summary", type: "string", description: "top result" },
              ],
            },
          ],
          autoTransitions: [
            {
              to: "extracting",
              gate: { kind: "taskSuccess", task: "search" },
            },
            { to: "needs_review", gate: { kind: "taskError", task: "search" } },
          ],
        },
        {
          id: "extracting",
          label: "Extracting",
          category: "active",
          tasks: [
            {
              id: "extractVerdict",
              label: "Extract verdict",
              role: "operation",
              extract: { ref: "./extractors/parse.ts", fields: ["verdict"] },
            },
          ],
          autoTransitions: [
            { to: "done", gate: { kind: "file", ref: "./gates/approved.ts" } },
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
              transitionTo: "searching",
            },
          ],
        },
        { id: "done", label: "Done", category: "terminal" },
      ],
    },
  ],
  edges: [],
  actions: [
    {
      id: "add_research",
      label: "Add research",
      variant: "primary",
      createInstance: {
        workflowId: "research",
        fields: [
          { key: "query", label: "Query", type: "string", required: true },
        ],
      },
    },
  ],
};

// The mock modules the compile step resolves refs to (the loader imports the
// real files; these mirror the implemented stubs).
function makeResolver(): RefResolver {
  const modules: Record<string, Record<string, unknown>> = {
    "./tools/websearch.ts": {
      websearchTools: [],
    },
    "./gates/approved.ts": {
      approved: (ctx: { workflowInstanceState: Record<string, unknown> }) =>
        ctx.workflowInstanceState.verdict === "approved",
    },
    "./extractors/parse.ts": {
      parse: (ctx: { taskOutputs: Record<string, unknown> }) => {
        const search = ctx.taskOutputs.search as
          | { output?: { completion?: { summary?: string } } }
          | undefined;
        const summary = search?.output?.completion?.summary ?? "";
        return { verdict: summary.includes("good") ? "approved" : "review" };
      },
    },
  };
  return (ref) => modules[ref] ?? {};
}

// An operation-only runner map (patch/extract ops run; no ai runners — the
// flows under test never reach an ai task).
function operationRunners(compiled: CompiledFlowDefinition) {
  return {
    operation: (ctx: TaskRunnerContext) =>
      createOperationRunner({
        operations: compiled.operations ?? {},
        getContext: () => ({
          flowConfig: () => ctx.flowConfig,
          patchFlowConfig: ctx.patchFlowConfig,
          instanceId: ctx.instanceId,
          workflowId: ctx.workflowId,
          currentState: ctx.currentState,
          workflowInstanceState: () => ctx.workflowInstanceState(),
          taskOutputs: () => ctx.taskOutputs,
          patchWorkflowInstanceState: ctx.patchWorkflowInstanceState,
          workflowInstancesInState: ctx.workflowInstancesInState,
        }),
      }),
  };
}

// ─── compile shape ────────────────────────────────────────────────────

describe("compileFlowDefinition", () => {
  it("collects every referenced module (kind + ref, deduplicated)", () => {
    const refs = collectDefinitionRefs(researchFlow);
    assert.deepEqual(refs, [
      { kind: "tool", ref: "./tools/websearch.ts" },
      { kind: "extract", ref: "./extractors/parse.ts" },
      { kind: "gate", ref: "./gates/approved.ts" },
    ]);
  });

  it("compiles a pure-data definition into the runtime projection", () => {
    const compiled = compileFlowDefinition(reviewFlow, makeResolver());
    assert.equal(compiled.id, "reviewFlow");
    assert.equal(compiled.label, "Review Flow");
    assert.equal(compiled.workflows.length, 1);
    assert.deepEqual(compiled.edges, []);
    assert.equal(compiled.tools, undefined); // the resolved tool list was empty
    // The flow-level action compiles with a createInstance payload.
    assert.equal(compiled.actions?.[0]?.id, "add_item");
    assert.equal(compiled.actions?.[0]?.createInstance?.workflowId, "items");
  });

  it("compiles gates to closures that evaluate against the runtime context", () => {
    const compiled = compileFlowDefinition(researchFlow, makeResolver());
    const state = compiled.workflows[0]?.states.find(
      (s) => s.id === "extracting"
    );
    const transitions = state?.autoTransitions ?? [];
    const approvedGate = transitions.find((t) => t.to === "done")?.gate;
    const fallbackGate = transitions.find((t) => t.to === "needs_review")?.gate;
    assert.ok(approvedGate, "the file-gate transition compiles");
    assert.ok(fallbackGate, "the always transition compiles");

    const base = {
      hasRunningTask: false,
      runningTaskContext: null,
      taskOutputs: {},
      workflowInstanceState: { verdict: "approved" },
      flowState: {},
      taskErrorCounts: {},
    };
    assert.equal(approvedGate({ ...base }), true);
    assert.equal(
      approvedGate({ ...base, workflowInstanceState: { verdict: "review" } }),
      false
    );
    assert.equal(fallbackGate({ ...base }), true);
  });

  it("generates the completion tool and offers it to the model", () => {
    const compiled = compileFlowDefinition(researchFlow, makeResolver());
    const toolNames = (compiled.tools ?? []).map(
      (tool) => tool.definition.function.name
    );
    assert.ok(
      toolNames.includes("research_search_complete"),
      "the generated completion tool is in the flow tools"
    );
    const searchTask = compiled.workflows[0]?.states
      .find((s) => s.id === "searching")
      ?.tasks?.find((t) => t.id === "search");
    assert.equal(searchTask?.completionTool, "research_search_complete");
    assert.ok(
      searchTask?.tools?.includes("research_search_complete"),
      "the completion tool is offered to the model"
    );
    const tool = compiled.tools?.find(
      (t) => t.definition.function.name === "research_search_complete"
    );
    const parameters = tool?.definition.function.parameters;
    assert.deepEqual(parameters?.required, ["summary"]);
    assert.equal(
      parameters?.properties.summary?.type,
      "string",
      "the completion schema carries the declared field types"
    );
  });

  it("generates the patch op (guards undefined sourced writes) and the extract op", () => {
    const flow: FlowDefinition = {
      id: "patchFlow",
      label: "Patch Flow",
      configSchema: [],
      workflows: [
        {
          id: "items",
          label: "Items",
          instanceState: [
            { field: "title", type: "string" },
            { field: "verdict", type: "string" },
          ],
          initial: "ready",
          terminalStates: ["done"],
          states: [
            {
              id: "ready",
              label: "Ready",
              tasks: [
                {
                  id: "run",
                  label: "Run",
                  role: "ai-task",
                  completionOutput: [{ field: "outcome", type: "string" }],
                },
                {
                  id: "record",
                  label: "Record",
                  role: "operation",
                  patch: {
                    verdict: {
                      kind: "taskOutput",
                      task: "run",
                      path: "output.outcome",
                    },
                    title: { kind: "literal", value: "hello" },
                  },
                },
              ],
              autoTransitions: [
                { to: "done", gate: { kind: "taskSuccess", task: "record" } },
              ],
            },
            { id: "done", label: "Done", category: "terminal" },
          ],
        },
      ],
      edges: [],
    };
    const compiled = compileFlowDefinition(flow, () => ({}));
    const recordTask = compiled.workflows[0]?.states[0]?.tasks?.find(
      (t) => t.id === "record"
    );
    assert.ok(
      recordTask?.operations?.includes("items_record_patch"),
      "the patch op is appended to the task's operations"
    );
    const patchOp = compiled.operations?.["items_record_patch"];
    assert.ok(patchOp, "the patch op is registered in the flow ops map");

    const ctx = {
      flowConfig: () => ({}),
      patchFlowConfig: () => {},
      instanceId: "inst-1",
      workflowId: "items",
      currentState: "ready",
      workflowInstanceState: () => ({}),
      taskOutputs: () =>
        ({
          run: { status: "success", output: { outcome: "approved" } },
        }) as Record<string, unknown>,
      patchWorkflowInstanceState: () => {},
      workflowInstancesInState: () => [],
    };
    const runResult = patchOp?.(
      { id: "record", label: "Record", role: "operation" },
      {},
      ctx
    );
    assert.deepEqual(runResult, { ok: true });

    // A sourced write that resolves to undefined is a contract failure.
    ctx.taskOutputs = () =>
      ({ run: { status: "error", output: undefined } }) as Record<
        string,
        unknown
      >;
    assert.throws(
      () =>
        patchOp?.(
          { id: "record", label: "Record", role: "operation" },
          {},
          ctx
        ),
      /did not produce the declared output \(verdict\)/
    );
  });

  it("compiles the four edge transform shapes", () => {
    const flow: FlowDefinition = {
      id: "edgeFlow",
      label: "Edge Flow",
      configSchema: [],
      workflows: [
        {
          id: "source",
          label: "Source",
          instanceState: [],
          initial: "done",
          terminalStates: ["done"],
          states: [{ id: "done", label: "Done" }],
        },
        {
          id: "target",
          label: "Target",
          instanceState: [{ field: "title", type: "string" }],
          initial: "ready",
          terminalStates: ["ready"],
          states: [{ id: "ready", label: "Ready" }],
        },
      ],
      edges: [
        {
          fromWorkflow: "source",
          fromStates: ["done"],
          toWorkflow: "target",
          fields: {
            title: {
              kind: "taskOutput",
              task: "planWork",
              path: "output.title",
            },
          },
        },
        {
          fromWorkflow: "source",
          fromStates: ["done"],
          toWorkflow: "target",
          fanOut: {
            task: "planWork",
            path: "output.items",
            fields: { title: { kind: "itemPath", path: "title" } },
          },
        },
        {
          fromWorkflow: "source",
          fromStates: ["done"],
          toWorkflow: "target",
          transform: { ref: "./edges/to-summary.ts", fields: ["title"] },
        },
        {
          fromWorkflow: "source",
          fromStates: ["done"],
          toWorkflow: "target",
        },
      ],
    };
    const compiled = compileFlowDefinition(flow, (ref) =>
      ref === "./edges/to-summary.ts"
        ? {
            toSummary: (source: Record<string, unknown>) => ({
              title: (source.planWork as { output?: { title?: string } })
                ?.output?.title,
            }),
          }
        : {}
    );
    assert.equal(compiled.edges.length, 4);
    const [fieldsEdge, fanOutEdge, transformEdge, signalEdge] = compiled.edges;
    // The runtime hands the erased output map to edge transforms (see
    // evaluate-edges); the fixture mirrors that erased shape.
    const source: Partial<TaskOutputMap<Record<string, unknown>>> = {
      planWork: {
        status: "success",
        output: { title: "T", items: [{ title: "A" }, { title: "B" }] },
      },
    };
    assert.deepEqual(fieldsEdge.transform?.(source), { title: "T" });
    assert.deepEqual(fanOutEdge.transform?.(source), [
      { title: "A" },
      { title: "B" },
    ]);
    assert.deepEqual(transformEdge.transform?.(source), [{ title: "T" }]);
    // A field-less edge is a pure signal: no transform closure is needed —
    // the engine treats a missing transform as an empty payload (create/merge
    // without data), identical to the renderer's `() => ({})` emission.
    assert.equal(signalEdge.transform, undefined);
  });
});

// ─── run the compiled definition ──────────────────────────────────────

describe("a compiled definition runs", () => {
  it("a review flow: create an instance and drive it with a state action", () => {
    const compiled = compileFlowDefinition(reviewFlow, makeResolver());
    const runtime = createFlowRuntime(
      "review-flow",
      compiled.workflows,
      compiled.edges,
      operationRunners(compiled),
      {},
      {},
      undefined
    );
    const instance = runtime.addWorkflowInstance("items", {
      workflowInstanceState: { title: "Card one" },
    });
    assert.equal(instance.getState().currentState, "new");

    const actions = instance.getAvailableActions();
    assert.ok(
      actions.some((action) => action.id === "complete"),
      "the compiled state action is available"
    );
    instance.dispatchAction("complete", {});
    assert.equal(instance.getState().currentState, "done");
  });

  it("a research loop: the extract op writes the verdict and the file gate routes to done", async () => {
    const compiled = compileFlowDefinition(researchFlow, makeResolver());
    const runtime = createFlowRuntime(
      "research-flow",
      compiled.workflows,
      compiled.edges,
      operationRunners(compiled),
      {},
      {},
      undefined
    );
    // Seed the instance mid-conversation: the search task's ai-chat output is
    // already complete (the transcript wraps the completion arguments).
    const instance = runtime.addWorkflowInstance("research", {
      currentState: "extracting",
      workflowInstanceState: { query: "hive" },
      taskOutputs: {
        search: {
          status: "success",
          output: {
            completion: { summary: "good result" },
          },
        },
      },
    });
    assert.equal(instance.getState().currentState, "extracting");
    // The initial-state auto task (extractVerdict) runs immediately for a
    // freshly created instance; the auto-transitions then evaluate after it.
    await instance.startAutoTasks();
    assert.equal(
      instance.getState().workflowInstanceState.verdict,
      "approved",
      "the generated extract op wrote the verdict"
    );
    assert.equal(instance.getState().currentState, "done");
  });
});
