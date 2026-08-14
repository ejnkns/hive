// Slice 1+2: the definition authoring surface — the definition module is the
// single pure-data artifact. A definition module validates clean, compiles
// clean (to the runtime projection), and runs. These tests cover the parser
// (module → data object), the validator (blueprint checks on the data
// object), and the loader seam (import → validate → compile → register).

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { compileFlowDefinition } from "workflow-engine/compile-flow-definition";
import { createFlowRuntime } from "workflow-engine/create-flow-runtime";
import { createOperationRunner } from "workflow-engine/runners";
import type { TaskRunnerContext } from "workflow-engine/task-runner";
import type {
  CompiledFlowDefinition,
  FlowDefinition,
} from "workflow-engine/workflow-types";
import {
  analyzeFlowDefinition,
  parseDefinition,
  validateFlowDefinition,
} from "./flow-definition.ts";
import {
  loadDefinitionFromSource,
  registerUserDefinition,
  resetFlowDefinitionsForTest,
  setDefinitionsBasePathForTest,
} from "./flow-definitions.ts";

// ─── a data definition module ─────────────────────────────────────────

// The research-loop definition as the agent writes it: `export const flow:
// FlowDefinition = { ... }` — workflows/states/tasks/actions as data, custom
// logic referenced by ref path (the module imports nothing).
const RESEARCH_MODULE = `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
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
            { to: "extracting", gate: { kind: "taskSuccess", task: "search" } },
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
`;

// The referenced modules the loader resolves (the implemented stubs).
const RESEARCH_FILES: Record<string, string> = {
  "./tools/websearch.ts": `import { defineTool } from "workflow-engine/runners";
export const websearchTools = [
  defineTool({
    name: "websearch",
    description: "Search the web and return the top result.",
    parameters: { properties: { query: { type: "string" } }, required: ["query"] },
    executor: async (call) => ({
      toolCallId: call.id,
      content: JSON.stringify({ title: "Hive docs", snippet: "good result" }),
      isError: false,
    }),
  }),
];
`,
  "./gates/approved.ts": `import type { GateContract } from "workflow-engine/workflow-types";
export const approved: GateContract = (ctx) => {
  return ctx.workflowInstanceState.verdict === "approved";
};
`,
  "./extractors/parse.ts": `import type { OutputExtractor } from "workflow-engine/workflow-types";
export const parse: OutputExtractor = (ctx) => {
  const search = ctx.taskOutputs.search as { output?: { completion?: { summary?: string } } } | undefined;
  const summary = search?.output?.completion?.summary ?? "";
  return { verdict: summary.includes("good") ? "approved" : "needs_review" };
};
`,
};

// ─── the parser ───────────────────────────────────────────────────────

describe("parseDefinition", () => {
  it("parses a definition module into the data definition object", () => {
    const { definition, findings } = parseDefinition(RESEARCH_MODULE);
    assert.deepEqual(findings, []);
    assert.equal(definition.id, "researchLoop");
    assert.equal(definition.workflows.length, 1);
    const research = definition.workflows[0];
    assert.equal(research.initial, "searching");
    assert.deepEqual(research.instanceState, [
      { field: "query", type: "string" },
      { field: "verdict", type: "string" },
    ]);
    const searchTask = research.states[0].tasks?.[0];
    assert.equal(searchTask?.role, "ai-chat");
    assert.deepEqual(searchTask?.completionOutput, [
      { field: "summary", type: "string", description: "top result" },
    ]);
    const extracting = research.states[1];
    assert.equal(extracting.tasks?.[0]?.extract?.ref, "./extractors/parse.ts");
    assert.deepEqual(extracting.autoTransitions?.[0]?.gate, {
      kind: "file",
      ref: "./gates/approved.ts",
    });
    assert.equal(definition.tools?.[0]?.id, "websearch");
    assert.equal(definition.actions?.[0]?.id, "add_research");
    // Round-trips through compile: the parsed object compiles to the runtime.
    const compiled = compileFlowDefinition(definition, (ref) => {
      const source = RESEARCH_FILES[ref] ?? "";
      // The stub modules are resolved by the loader in production; the parse
      // test only needs the compile step to see a namespace per ref.
      void source;
      return {};
    });
    assert.ok("workflows" in compiled);
  });

  it("flags a hand-written shape the definition cannot carry", () => {
    const { findings } = parseDefinition(
      RESEARCH_MODULE.replace(
        '{ to: "done", gate: { kind: "file", ref: "./gates/approved.ts" } },',
        '{ to: "done", gate: (ctx) => true },'
      )
    );
    assert.ok(
      findings.some((f) => f.includes("gate")),
      `the closure gate surfaces as a finding: ${findings.join("; ")}`
    );
  });
});

// ─── the validator ────────────────────────────────────────────────────

describe("validateFlowDefinition", () => {
  it("validates the parsed research-loop definition clean (zero errors)", () => {
    const { definition } = parseDefinition(RESEARCH_MODULE);
    const errors = validateFlowDefinition(definition);
    assert.deepEqual(errors, []);
    // One advisory: the extractor's task-output read lives in a referenced
    // module, invisible to the analyzer (the module-set gate checks the
    // referenced files; the definition's open parts are analyzed best-effort).
    const warnings = analyzeFlowDefinition(definition);
    assert.deepEqual(warnings, [
      'workflow "research" task "search" declares completionOutput but nothing reads its output — record it with a sibling patch op or an edge, or drop the declaration',
    ]);
  });

  it("rejects an unknown transition target", () => {
    const { definition } = parseDefinition(
      RESEARCH_MODULE.replace('{ to: "extracting"', '{ to: "missing"')
    );
    const errors = validateFlowDefinition(definition);
    assert.ok(
      errors.some((e) => e.message.includes("targets unknown state")),
      `the missing state is caught: ${errors.map((e) => e.message).join("; ")}`
    );
  });

  it("rejects a read of an undeclared instance-state field", () => {
    const { definition } = parseDefinition(
      RESEARCH_MODULE.replace(
        '{ to: "needs_review", gate: { kind: "always" } },',
        '{ to: "needs_review", gate: { kind: "instanceStateEquals", field: "missing", value: "x" } },'
      )
    );
    const errors = validateFlowDefinition(definition);
    assert.ok(
      errors.some((e) => e.message.includes('"missing" which is not declared')),
      `the undeclared read is caught: ${errors.map((e) => e.message).join("; ")}`
    );
  });
});

// ─── the loader seam: import → validate → compile → run ──────────────

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

describe("loadDefinitionFromSource (a definition module validates → compiles → runs)", () => {
  it("loads a data definition module: validates, compiles, and keeps the data form", async () => {
    const loaded = await loadDefinitionFromSource(
      "definition-seam",
      RESEARCH_MODULE,
      "researchLoop",
      RESEARCH_FILES
    );
    const compiled = loaded.flow;
    assert.equal(compiled.id, "researchLoop");
    assert.ok("workflows" in compiled);
    if ("workflows" in compiled) {
      assert.equal(compiled.workflows.length, 1);
    }
    // The generated completion tool is in the compiled tools.
    const toolNames = (compiled.tools ?? []).map(
      (tool) => tool.definition.function.name
    );
    assert.ok(toolNames.includes("research_search_complete"));
    // The data form rides alongside the compiled projection.
    assert.ok(loaded.definition);
    assert.equal(loaded.definition?.workflows[0]?.instanceState.length, 2);
  });

  it("runs the compiled definition: the extract op writes the verdict and the file gate routes to done", async () => {
    const loaded = await loadDefinitionFromSource(
      "definition-seam-run",
      RESEARCH_MODULE,
      "researchLoop",
      RESEARCH_FILES
    );
    if (!("workflows" in loaded.flow)) {
      throw new Error("expected a static definition");
    }
    const runtime = createFlowRuntime(
      "research-flow",
      loaded.flow.workflows,
      loaded.flow.edges,
      operationRunners(loaded.flow),
      {},
      {},
      undefined
    );
    const instance = runtime.addWorkflowInstance("research", {
      currentState: "extracting",
      workflowInstanceState: { query: "hive" },
      taskOutputs: {
        search: {
          status: "success",
          output: { completion: { summary: "good result" } },
        },
      },
    });
    await instance.startAutoTasks();
    assert.equal(
      instance.getState().workflowInstanceState.verdict,
      "approved",
      "the generated extract op wrote the verdict"
    );
    assert.equal(instance.getState().currentState, "done");
  });

  it("registers a data definition module through registerUserDefinition", async () => {
    const defsDir = mkdtempSync(join(tmpdir(), "hive-definition-seam-"));
    setDefinitionsBasePathForTest(defsDir);
    resetFlowDefinitionsForTest();
    try {
      const record = await registerUserDefinition({
        name: "Research Loop",
        source: RESEARCH_MODULE,
        files: RESEARCH_FILES,
      });
      assert.equal(record.id, "research-loop");
      assert.equal(record.flow.id, "research-loop");
      // The data form stays faithful to the module's declared id; the compiled
      // projection is re-stamped to the record slug (existing behavior).
      assert.equal(record.definition?.id, "researchLoop");
      assert.ok("workflows" in record.flow);
      assert.equal(
        record.files?.["./gates/approved.ts"],
        RESEARCH_FILES["./gates/approved.ts"]
      );
    } finally {
      resetFlowDefinitionsForTest();
    }
  });

  it("rejects a data definition that fails validation at load", async () => {
    const broken = RESEARCH_MODULE.replace(
      '{ to: "extracting"',
      '{ to: "missing"'
    );
    await assert.rejects(
      loadDefinitionFromSource("definition-seam-bad", broken, "bad", {}),
      /validation failed/
    );
  });
});
