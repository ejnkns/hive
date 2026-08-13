// The module-set seam: a blueprint with file references goes validate → render
// (entry + stubs) → materialize → lint → load → typecheck → execute in a real
// FlowRuntime. Malformed references produce specific, model-actionable
// findings; a valid set executes with the custom code behaving — the custom
// gate decides a transition, the custom tool returns its shaped result (the
// primitive transport is the test's stubbed executor), and the custom
// operation/transform/extract all run.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createFlowRuntime } from "workflow-engine/create-flow-runtime";
import {
  createAiChatRunner,
  createOperationRunner,
  createStandardToolDefinitions,
  createStandardToolRegistry,
  type OperationContext,
  toToolMaps,
} from "workflow-engine/runners";
import type { ToolCall } from "workflow-engine/runners/tool-types";
import type { TaskRunnerContext } from "workflow-engine/task-runner";
import type { FlowDefinition } from "workflow-engine/workflow-types";
import { flow as queenBeeFlow } from "../../../presets/queen-bee/flow.ts";
import type { FlowBlueprint } from "./flow-blueprint.ts";
import { validateFlowBlueprint } from "./flow-blueprint.ts";
import {
  getRegisteredFlowDefinition,
  loadUserDefinitionsFromDisk,
  registerFlowDefinition,
  registerUserDefinition,
  resetFlowDefinitionsForTest,
  setDefinitionsBasePathForTest,
} from "./flow-definitions.ts";
import {
  lintModuleSet,
  loadModuleSetDefinition,
  materializeModuleSet,
  readModuleSetFiles,
  runModuleSetGate,
} from "./module-set.ts";
import { renderFlowDefinition } from "./render-flow-definition.ts";

// ─── the five-kind blueprint ──────────────────────────────────────────

// A research flow whose gates, tool, operations, edge transform, and output
// extractor are all blueprint-referenced files. The test implements the stubs
// and runs the whole thing in a real FlowRuntime.
export const FIVE_KIND: FlowBlueprint = {
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
              startOnUserInput: true,
            },
            {
              id: "scoreResult",
              label: "Score the result",
              role: "operation",
              operations: ["score"],
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
            {
              id: "annotateResult",
              label: "Annotate the result",
              role: "operation",
              operations: [{ ref: "./ops/annotate.ts" }],
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
      transform: { ref: "./edges/to-summary.ts", fields: ["title", "body"] },
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
          { key: "query", label: "Query", type: "string", required: true },
        ],
      },
    },
  ],
};

// ─── implemented stubs (the "implement the stub" step) ────────────────

export const IMPLEMENTED_GATE = `import type { GateContract } from "workflow-engine/workflow-types";

export const approved: GateContract = (ctx) => {
  return ctx.workflowInstanceState.verdict === "approved";
};
`;

export const IMPLEMENTED_TOOL = `import { defineTool } from "workflow-engine/runners";

let websearchCalls = 0;

export const websearchTools = [
  defineTool({
    name: "websearch",
    description: "Search the web and return the top result.",
    parameters: {
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    executor: async (call) => {
      websearchCalls += 1;
      return {
        toolCallId: call.id,
        content: JSON.stringify({ title: "Hive docs", snippet: "good result" }),
        isError: false,
      };
    },
  }),
];

export function websearchCallCount(): number {
  return websearchCalls;
}
`;

export const IMPLEMENTED_SCORE = `import { defineOperations, type OperationContext } from "workflow-engine/runners";

export const scoreOperations = defineOperations<Record<string, unknown>>({
  score: (task, params, ctx: OperationContext) => {
    return { score: 7 };
  },
});
`;

export const IMPLEMENTED_ANNOTATE = `import { defineOperations, type OperationContext } from "workflow-engine/runners";

export const annotateOperations = defineOperations<Record<string, unknown>>({
  annotate: (task, params, ctx: OperationContext) => {
    return { ok: true };
  },
});
`;

export const IMPLEMENTED_TRANSFORM = `import type { TransformContract } from "workflow-engine/workflow-types";

export const toSummary: TransformContract = (source) => {
  const search = source.search as { output?: { completion?: { summary?: string } } } | undefined;
  return { title: "Summary", body: search?.output?.completion?.summary ?? "" };
};
`;

export const IMPLEMENTED_EXTRACT = `import type { OutputExtractor } from "workflow-engine/workflow-types";

export const parseResult: OutputExtractor = (ctx) => {
  const search = ctx.taskOutputs.search as { output?: { completion?: { summary?: string } } } | undefined;
  const summary = search?.output?.completion?.summary ?? "";
  return { verdict: summary.includes("good") ? "approved" : "needs_review" };
};
`;

// ─── runtime harness ──────────────────────────────────────────────────

function operationContext(ctx: TaskRunnerContext): OperationContext {
  return {
    flowConfig: () => ctx.flowConfig,
    patchFlowConfig: ctx.patchFlowConfig,
    instanceId: ctx.instanceId,
    workflowId: ctx.workflowId,
    currentState: ctx.currentState,
    workflowInstanceState: ctx.workflowInstanceState,
    taskOutputs: () => ctx.taskOutputs,
    patchWorkflowInstanceState: ctx.patchWorkflowInstanceState,
    workflowInstancesInState: ctx.workflowInstancesInState,
  };
}

// The ai-chat model caller: turn 1 calls the custom websearch tool, turn 2
// completes via complete_task with a summary the extractor can classify.
function searchScript(): typeof createAiChatRunner extends never
  ? never
  : (
      systemPrompt: string,
      messages: unknown[],
      tools: unknown[],
      signal: unknown
    ) => Promise<{ content: string; toolCalls?: ToolCall[] }> {
  let turn = 0;
  return async () => {
    turn += 1;
    if (turn === 1) {
      return {
        content: "Searching for hive.",
        toolCalls: [
          {
            id: "w1",
            name: "websearch",
            arguments: JSON.stringify({ query: "hive" }),
          },
        ],
      };
    }
    return {
      content: "Found it.",
      toolCalls: [
        {
          id: "c1",
          name: "complete_task",
          arguments: JSON.stringify({
            outcome: "implemented",
            summary: "good result",
            rationale: "found it",
          }),
        },
      ],
    };
  };
}

function buildRuntime(
  flow: Awaited<ReturnType<typeof loadModuleSetDefinition>>,
  modelCaller: ReturnType<typeof searchScript>
) {
  if (!("workflows" in flow)) {
    throw new Error(
      "expected a static definition, got a buildWorkflows factory"
    );
  }
  const toolMaps = toToolMaps(flow.tools ?? []);
  const toolDefinitions = {
    ...createStandardToolDefinitions(),
    ...toolMaps.definitions,
  };
  const toolExecutors = {
    ...createStandardToolRegistry(),
    ...toolMaps.executors,
  };
  return createFlowRuntime("seam-flow", flow.workflows, flow.edges, {
    "ai-chat": (ctx) =>
      createAiChatRunner({
        modelCaller,
        toolDefinitions,
        toolExecutors,
        patchWorkflowInstanceState: ctx.patchWorkflowInstanceState,
        workflowInstanceState: ctx.workflowInstanceState,
        patchRunningTaskMessages: ctx.patchRunningTaskMessages,
        createWorkflowInstance: ctx.createWorkflowInstance,
      }),
    operation: (ctx) =>
      createOperationRunner({
        getContext: () => operationContext(ctx),
        operations: flow.operations ?? {},
      }),
  });
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 8000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timed out waiting for the runtime");
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 30));
}

// ─── tests ────────────────────────────────────────────────────────────

describe("module-set pipeline", () => {
  it("materializes the module set and lints a clean blueprint clean", async () => {
    const rendered = renderFlowDefinition(FIVE_KIND);
    const dir = materializeModuleSet("seam-clean", rendered);
    assert.ok(existsSync(join(dir, "flow.ts")));
    assert.ok(existsSync(join(dir, "gates/approved.ts")));
    assert.deepEqual(lintModuleSet(FIVE_KIND, dir), []);
  });

  it("reports a missing referenced file with a specific finding", async () => {
    const rendered = renderFlowDefinition(FIVE_KIND);
    const dir = materializeModuleSet("seam-missing", rendered);
    rmSync(join(dir, "gates/approved.ts"));
    const findings = lintModuleSet(FIVE_KIND, dir);
    const finding = findings.find((f) => f.ref === "./gates/approved.ts");
    assert.ok(
      finding,
      `expected a finding for the gate, got ${JSON.stringify(findings)}`
    );
    assert.match(finding.message, /does not exist/);
  });

  it("reports a ref escaping the definition root", async () => {
    const blueprint: FlowBlueprint = {
      ...FIVE_KIND,
      workflows: [
        {
          ...FIVE_KIND.workflows[0],
          states: FIVE_KIND.workflows[0].states.map((s) =>
            s.id === "extracting"
              ? {
                  ...s,
                  autoTransitions: [
                    {
                      to: "done",
                      gate: { kind: "file", ref: "../escape.ts" },
                    },
                    { to: "needs_review", gate: { kind: "always" } },
                  ],
                }
              : s
          ),
        },
        ...FIVE_KIND.workflows.slice(1),
      ],
    };
    assert.deepEqual(validateFlowBlueprint(blueprint), []);
    const rendered = renderFlowDefinition(blueprint);
    const dir = materializeModuleSet("seam-escape", rendered);
    // The escaping ref is never written outside the module-set directory.
    assert.ok(!existsSync(join(dir, "../escape.ts")));
    const findings = lintModuleSet(blueprint, dir);
    const finding = findings.find((f) => f.ref === "../escape.ts");
    assert.ok(
      finding,
      `expected an escape finding, got ${JSON.stringify(findings)}`
    );
    assert.match(finding.message, /outside the definition root/);
  });

  it("reports a misnamed export", async () => {
    const rendered = renderFlowDefinition(FIVE_KIND);
    const dir = materializeModuleSet("seam-export", rendered);
    writeFileSync(
      join(dir, "gates/approved.ts"),
      `import type { GateContract } from "workflow-engine/workflow-types";\nexport const wrongName: GateContract = () => false;\n`
    );
    const findings = lintModuleSet(FIVE_KIND, dir);
    const finding = findings.find((f) => f.ref === "./gates/approved.ts");
    assert.ok(
      finding,
      `expected an export finding, got ${JSON.stringify(findings)}`
    );
    assert.match(finding.message, /does not export/);
    assert.match(finding.message, /approved/);
  });

  it("reports a contract mismatch", async () => {
    const rendered = renderFlowDefinition(FIVE_KIND);
    const dir = materializeModuleSet("seam-contract", rendered);
    writeFileSync(
      join(dir, "gates/approved.ts"),
      `import type { RuntimeGateContext } from "workflow-engine/workflow-types";\nexport const approved = (ctx: RuntimeGateContext) => "yes";\n`
    );
    const findings = lintModuleSet(FIVE_KIND, dir);
    const finding = findings.find((f) => f.ref === "./gates/approved.ts");
    assert.ok(
      finding,
      `expected a contract finding, got ${JSON.stringify(findings)}`
    );
    assert.match(finding.message, /not assignable/);
  });

  it("typechecks the whole set and parses diagnostics with the file path", async () => {
    const rendered = renderFlowDefinition(FIVE_KIND);
    const dir = materializeModuleSet("seam-typecheck", rendered);
    writeFileSync(
      join(dir, "extractors/parse-result.ts"),
      `import type { OutputExtractor } from "workflow-engine/workflow-types";\nexport const parseResult: OutputExtractor = (ctx) => ctx.nonexistent;\n`
    );
    const result = await runModuleSetGate(
      "seam-typecheck",
      FIVE_KIND,
      rendered
    );
    assert.ok(
      result.errors.some((e) =>
        /typecheck extractors\/parse-result\.ts:\d+:\d+/.test(e)
      ),
      `expected a parsed typecheck diagnostic, got ${JSON.stringify(result.errors)}`
    );
  });

  it("a valid implemented module set loads, typechecks, and executes in a real FlowRuntime", async () => {
    const rendered = renderFlowDefinition(FIVE_KIND);
    const dir = materializeModuleSet("seam-runtime", rendered);
    writeFileSync(join(dir, "gates/approved.ts"), IMPLEMENTED_GATE);
    writeFileSync(join(dir, "tools/websearch.ts"), IMPLEMENTED_TOOL);
    writeFileSync(join(dir, "ops/score.ts"), IMPLEMENTED_SCORE);
    writeFileSync(join(dir, "ops/annotate.ts"), IMPLEMENTED_ANNOTATE);
    writeFileSync(join(dir, "edges/to-summary.ts"), IMPLEMENTED_TRANSFORM);
    writeFileSync(join(dir, "extractors/parse-result.ts"), IMPLEMENTED_EXTRACT);

    const gate = await runModuleSetGate("seam-runtime", FIVE_KIND, rendered);
    assert.deepEqual(gate.errors, []);
    assert.ok(gate.flow, "the module set must load");

    const runtime = buildRuntime(gate.flow, searchScript());
    const controller = runtime.addWorkflowInstance("research", {
      workflowInstanceState: { query: "hive" },
    });
    await settle();
    assert.ok(
      controller.getState().hasRunningTask,
      "the search task waits for input"
    );
    // Send the first user message to release the interactive search task.
    controller.sendTaskInput("search", "find hive", "user");
    await waitFor(() =>
      runtime.workflowInstances.some((i) => i.currentState === "done")
    );

    const research = runtime
      .getWorkflowInstanceEntries()
      .find((e) => e.workflowId === "research");
    assert.equal(research?.state.currentState, "done");
    const state = research?.state.workflowInstanceState;
    assert.equal(state?.score, 7, "the custom score operation ran");
    assert.equal(
      state?.result,
      "good result",
      "the shaped result was recorded"
    );
    assert.equal(state?.verdict, "approved", "the custom extractor ran");

    // The custom gate decided the transition: verdict approved → done, and the
    // edge transform fed the summary instance.
    const summary = runtime
      .getWorkflowInstanceEntries()
      .find((e) => e.workflowId === "summary");
    assert.ok(summary, "the edge transform created a summary instance");
    assert.equal(summary.state.workflowInstanceState.title, "Summary");
    assert.equal(summary.state.workflowInstanceState.body, "good result");

    // The custom tool executed exactly once (the primitive transport is the
    // test's stubbed executor) and returned its shaped result: its result
    // content appears in the ai-chat transcript as a tool message. The runtime
    // loads a fresh copy of the module set, so the assertion is on behavior
    // (the transcript), not on a module-scoped counter.
    const searchOutput = JSON.stringify(
      research?.state.taskOutputs.search?.output ?? {}
    );
    assert.ok(
      searchOutput.includes("Hive docs"),
      "the websearch tool's shaped result must appear in the transcript"
    );
  });

  it("the definition record stores the blueprint and file set; loading re-materializes the directory", async () => {
    const defsDir = mkdtempSync(join(tmpdir(), "hive-module-set-"));
    setDefinitionsBasePathForTest(defsDir);
    resetFlowDefinitionsForTest();
    try {
      const rendered = renderFlowDefinition(FIVE_KIND);
      const dir = materializeModuleSet("seam-record", rendered);
      writeFileSync(join(dir, "gates/approved.ts"), IMPLEMENTED_GATE);
      const files = readModuleSetFiles(dir);

      const record = await registerUserDefinition({
        name: "Module Set Flow",
        source: rendered.entry,
        blueprint: FIVE_KIND,
        files,
      });
      assert.equal(record.blueprint?.id, "moduleSetFlow");
      assert.equal(record.files?.["./gates/approved.ts"], IMPLEMENTED_GATE);
      // Persisted as a module-set directory.
      assert.ok(
        existsSync(join(defsDir, "definitions", "module-set-flow/flow.ts"))
      );
      assert.ok(
        existsSync(
          join(defsDir, "definitions", "module-set-flow/gates/approved.ts")
        )
      );

      // Boot reload re-materializes and loads; the entry imports the files, so
      // the custom gate is live.
      resetFlowDefinitionsForTest();
      registerFlowDefinition(queenBeeFlow, { builtIn: true });
      await loadUserDefinitionsFromDisk();
      const reloaded = getRegisteredFlowDefinition("module-set-flow");
      assert.ok(reloaded, "the module-set definition must reload from disk");
      const reloadedFlow = reloaded.flow;
      if (!("workflows" in reloadedFlow)) {
        throw new Error("expected a static definition");
      }
      const extracting = reloadedFlow.workflows
        .find((wf) => wf.id === "research")
        ?.states.find((s) => s.id === "extracting");
      const gate = extracting?.autoTransitions?.find(
        (t) => t.to === "done"
      )?.gate;
      assert.equal(typeof gate, "function");
      const verdict = (gate as (ctx: unknown) => boolean)({
        workflowInstanceState: { verdict: "approved" },
      });
      assert.equal(
        verdict,
        true,
        "the entry imports the implemented gate file"
      );
    } finally {
      rmSync(defsDir, { recursive: true, force: true });
      resetFlowDefinitionsForTest();
    }
  });
});

// ─── the gate's custom code helpers ───────────────────────────────────

const GATE_ALWAYS_TRUE = `import type { GateContract } from "workflow-engine/workflow-types";
export const approved: GateContract = (ctx) => true;
`;

const GATE_ALWAYS_FALSE = `import type { GateContract } from "workflow-engine/workflow-types";
export const approved: GateContract = (ctx) => false;
`;

function approvedGateOf(flow: FlowDefinition): (ctx: unknown) => boolean {
  if (!("workflows" in flow)) {
    throw new Error("expected a static definition");
  }
  const extracting = flow.workflows
    .find((wf) => wf.id === "research")
    ?.states.find((s) => s.id === "extracting");
  const gate = extracting?.autoTransitions?.find((t) => t.to === "done")?.gate;
  assert.equal(typeof gate, "function");
  return gate as (ctx: unknown) => boolean;
}

describe("module-set loading", () => {
  it("re-loading a module set serves hand edits (no stale module cache)", async () => {
    const rendered = renderFlowDefinition(FIVE_KIND);
    const dir = materializeModuleSet("seam-reload", rendered);
    writeFileSync(join(dir, "gates/approved.ts"), GATE_ALWAYS_TRUE);
    const flow1 = await loadModuleSetDefinition(dir);
    assert.equal(
      approvedGateOf(flow1)({
        workflowInstanceState: { verdict: "needs_review" },
      }),
      true,
      "first load serves the implemented gate"
    );

    writeFileSync(join(dir, "gates/approved.ts"), GATE_ALWAYS_FALSE);
    const flow2 = await loadModuleSetDefinition(dir);
    assert.equal(
      approvedGateOf(flow2)({ workflowInstanceState: { verdict: "approved" } }),
      false,
      "a second load serves the edited gate, not the cached first version"
    );
  });
});

describe("import policy", () => {
  it("rejects a referenced file importing an undeclared package", async () => {
    const rendered = renderFlowDefinition(FIVE_KIND);
    const dir = materializeModuleSet("seam-import-undeclared", rendered);
    writeFileSync(
      join(dir, "gates/approved.ts"),
      `import axios from "axios";\n${IMPLEMENTED_GATE}`
    );
    const result = await runModuleSetGate(
      "seam-import-undeclared",
      FIVE_KIND,
      rendered
    );
    assert.ok(
      result.errors.some((e) => /axios/.test(e) && /dependencies/.test(e)),
      `expected a dependency finding, got ${JSON.stringify(result.errors)}`
    );
  });

  it("declaring the package in dependencies makes the same import pass", async () => {
    // lru-cache is an installed server dependency, so a declared import of it
    // passes the policy AND resolves at load and typecheck.
    const blueprint = { ...FIVE_KIND, dependencies: ["lru-cache"] };
    const rendered = renderFlowDefinition(blueprint);
    const dir = materializeModuleSet("seam-import-declared", rendered);
    writeFileSync(
      join(dir, "gates/approved.ts"),
      `import { LRUCache } from "lru-cache";\nexport const approved = (ctx: unknown): boolean => { void LRUCache; return true; };\n`
    );
    const result = await runModuleSetGate(
      "seam-import-declared",
      blueprint,
      rendered
    );
    assert.deepEqual(result.errors, []);
  });

  it("allows engine primitives, node: builtins, and the flow's own files without declaration", async () => {
    const rendered = renderFlowDefinition(FIVE_KIND);
    const dir = materializeModuleSet("seam-import-allowed", rendered);
    writeFileSync(
      join(dir, "gates/helpers.ts"),
      `import { join } from "node:path";\nexport function helper(): boolean { void join; return false; }\n`
    );
    writeFileSync(
      join(dir, "gates/approved.ts"),
      `import type { GateContract } from "workflow-engine/workflow-types";\nimport { helper } from "./helpers.ts";\nexport const approved: GateContract = (ctx) => helper();\n`
    );
    const result = await runModuleSetGate(
      "seam-import-allowed",
      FIVE_KIND,
      rendered
    );
    assert.deepEqual(result.errors, []);
  });

  it("rejects a relative import escaping the module set", async () => {
    const rendered = renderFlowDefinition(FIVE_KIND);
    const dir = materializeModuleSet("seam-import-escape", rendered);
    writeFileSync(
      join(dir, "gates/approved.ts"),
      `import { x } from "../../outside.ts";\n${IMPLEMENTED_GATE}`
    );
    const result = await runModuleSetGate(
      "seam-import-escape",
      FIVE_KIND,
      rendered
    );
    assert.ok(
      result.errors.some((e) => /resolves outside the module set/.test(e)),
      `expected an escape finding, got ${JSON.stringify(result.errors)}`
    );
  });
});
