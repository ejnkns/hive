// Slice 1+2: the definition authoring surface — the definition module is the
// single pure-data artifact. A definition module validates clean, compiles
// clean (to the runtime projection), and runs. These tests cover the parser
// (module → data object), the validator (blueprint checks on the data
// object), and the loader seam (import → validate → compile → register).

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { compileFlowDefinition } from "workflow-engine/compile-flow-definition";
import { createFlowRuntime } from "workflow-engine/create-flow-runtime";
import {
  createAiTaskRunner,
  createOperationRunner,
  createStandardToolDefinitions,
  createStandardToolRegistry,
  toToolMaps,
} from "workflow-engine/runners";
import type { TaskRunnerContext } from "workflow-engine/task-runner";
import type { CompiledFlowDefinition } from "workflow-engine/workflow-types";
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
import { loadPresetDefinition } from "./preset-flow.ts";

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
    // No advisory: the search task's output IS read — by the referenced
    // extractor (./extractors/parse.ts) and the file gate
    // (./gates/approved.ts). Those reads live inside referenced modules,
    // invisible to the analyzer, so it treats the workflow's file-backed
    // readers as best-effort readers and stays quiet.
    const warnings = analyzeFlowDefinition(definition);
    assert.deepEqual(warnings, []);
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

  it("accepts a destructive deletesInstance action with no transition target (E5)", () => {
    const module = `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "deletableFlow",
  label: "Deletable Flow",
  configSchema: [],
  workflows: [
    {
      id: "ideas",
      label: "Ideas",
      instanceState: [{ field: "title", type: "string" }],
      initial: "imported",
      terminalStates: ["done"],
      states: [
        {
          id: "imported",
          label: "Imported",
          actions: [
            {
              id: "discard",
              label: "Discard",
              variant: "destructive",
              deletesInstance: true,
            },
          ],
        },
        { id: "done", label: "Done", category: "terminal" },
      ],
    },
  ],
  actions: [
    {
      id: "add_idea",
      label: "Add idea",
      createInstance: {
        workflowId: "ideas",
        fields: [{ key: "title", label: "Title", type: "string", required: true }],
      },
    },
  ],
};
`;
    const { definition, findings } = parseDefinition(module);
    assert.deepEqual(findings, []);
    assert.deepEqual(validateFlowDefinition(definition), []);
    assert.deepEqual(analyzeFlowDefinition(definition), []);
  });

  it("rejects deletesInstance on a non-destructive variant", () => {
    const module = `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "badDelete",
  label: "Bad Delete",
  configSchema: [],
  workflows: [
    {
      id: "ideas",
      label: "Ideas",
      instanceState: [],
      initial: "imported",
      terminalStates: ["imported"],
      states: [
        {
          id: "imported",
          label: "Imported",
          actions: [
            {
              id: "discard",
              label: "Discard",
              variant: "primary",
              deletesInstance: true,
            },
          ],
        },
      ],
    },
  ],
};
`;
    const { definition } = parseDefinition(module);
    const errors = validateFlowDefinition(definition);
    assert.ok(
      errors.some((e) =>
        e.message.includes("deletesInstance requires a destructive variant")
      ),
      `expected a destructive-variant finding, got ${errors.map((e) => e.message).join("; ")}`
    );
  });

  it("rejects deletesInstance combined with a transition target", () => {
    const module = `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "badDelete",
  label: "Bad Delete",
  configSchema: [],
  workflows: [
    {
      id: "ideas",
      label: "Ideas",
      instanceState: [],
      initial: "imported",
      terminalStates: ["imported"],
      states: [
        {
          id: "imported",
          label: "Imported",
          actions: [
            {
              id: "discard",
              label: "Discard",
              variant: "destructive",
              deletesInstance: true,
              transitionTo: "done",
            },
          ],
        },
        { id: "done", label: "Done" },
      ],
    },
  ],
};
`;
    const { definition } = parseDefinition(module);
    const errors = validateFlowDefinition(definition);
    assert.ok(
      errors.some((e) =>
        e.message.includes("deletesInstance removes the instance")
      ),
      `expected a transition-conflict finding, got ${errors.map((e) => e.message).join("; ")}`
    );
  });

  it("rejects a state action with neither transitionTo nor deletesInstance", () => {
    const module = `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "stuckAction",
  label: "Stuck Action",
  configSchema: [],
  workflows: [
    {
      id: "ideas",
      label: "Ideas",
      instanceState: [],
      initial: "imported",
      terminalStates: ["imported"],
      states: [
        {
          id: "imported",
          label: "Imported",
          actions: [{ id: "stuck", label: "Stuck" }],
        },
      ],
    },
  ],
};
`;
    const { definition } = parseDefinition(module);
    const errors = validateFlowDefinition(definition);
    assert.ok(
      errors.some((e) =>
        e.message.includes("must declare transitionTo or deletesInstance")
      ),
      `expected a missing-target finding, got ${errors.map((e) => e.message).join("; ")}`
    );
  });

  it("still flags a completionOutput nobody reads when no referenced file can", () => {
    // No extract, no custom ops, no file gates, no edge transforms — the
    // output is genuinely discarded, so the advisory must fire.
    const { definition } = parseDefinition(DISCARDED_MODULE);
    assert.deepEqual(analyzeFlowDefinition(definition), [
      'workflow "items" task "research" declares completionOutput but nothing reads its output — record it with a sibling patch op or an edge, or drop the declaration',
    ]);
  });

  it("treats referenced operations and edge transforms as best-effort readers", () => {
    // A flow-level custom op used by a task and an edge transform from the
    // workflow both read task outputs from inside referenced files — the
    // advisory must stay quiet for the workflow.
    const { definition } = parseDefinition(FILE_READER_MODULE);
    assert.deepEqual(analyzeFlowDefinition(definition), []);
  });

  it("accepts a board groupByField on a declared instance-state field and rejects undeclared ones (E3)", () => {
    const base = `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "groupedFlow",
  label: "Grouped Flow",
  configSchema: [],
  workflows: [
    {
      id: "ideas",
      label: "Ideas",
      ui: { groupByField: "__FIELD__" },
      instance: { title: "title" },
      instanceState: [
        { field: "title", type: "string" },
        { field: "category", type: "string" },
      ],
      initial: "imported",
      terminalStates: ["imported"],
      states: [{ id: "imported", label: "Imported" }],
    },
  ],
  actions: [
    {
      id: "add_idea",
      label: "Add idea",
      createInstance: {
        workflowId: "ideas",
        fields: [
          { key: "title", label: "Title", type: "string", required: true },
          { key: "category", label: "Category", type: "string" },
        ],
      },
    },
  ],
};
`;
    // Declared field: validates clean (category has a writer via the
    // createInstance payload, so the partition read is satisfied).
    const ok = parseDefinition(base.replace("__FIELD__", "category"));
    assert.deepEqual(ok.findings, []);
    assert.deepEqual(validateFlowDefinition(ok.definition), []);

    // Undeclared field: rejected.
    const bad = parseDefinition(base.replace("__FIELD__", "nope"));
    const errors = validateFlowDefinition(bad.definition);
    assert.ok(
      errors.some((e) =>
        e.message.includes(
          'ui.groupByField references undeclared state field "nope"'
        )
      ),
      `expected an undeclared-field finding, got ${errors.map((e) => e.message).join("; ")}`
    );
  });

  it("rejects a workflow declaring both groupByField and columns", () => {
    const module = `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "conflictingUi",
  label: "Conflicting Ui",
  configSchema: [],
  workflows: [
    {
      id: "ideas",
      label: "Ideas",
      ui: {
        groupByField: "category",
        columns: [{ id: "lane", label: "Lane", states: ["imported"] }],
      },
      instanceState: [{ field: "category", type: "string" }],
      initial: "imported",
      terminalStates: ["imported"],
      states: [{ id: "imported", label: "Imported" }],
    },
  ],
};
`;
    const { definition } = parseDefinition(module);
    const errors = validateFlowDefinition(definition);
    assert.ok(
      errors.some((e) =>
        e.message.includes("declares both groupByField and columns")
      ),
      `expected a conflict finding, got ${errors.map((e) => e.message).join("; ")}`
    );
  });

  it("accepts an edit field with optionsFrom and rejects bad flowState sources (E4)", () => {
    const base = `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "optionsFlow",
  label: "Options Flow",
  configSchema: [],
  flowState: [{ field: "taxonomy", type: "object" }],
  workflows: [
    {
      id: "ideas",
      label: "Ideas",
      instance: { title: "title" },
      editFields: [
        { key: "category", label: "Category", type: "string", optionsFrom: { flowState: "__SOURCE__" } },
      ],
      instanceState: [
        { field: "title", type: "string" },
        { field: "category", type: "string" },
      ],
      initial: "imported",
      terminalStates: ["imported"],
      states: [{ id: "imported", label: "Imported" }],
    },
  ],
  actions: [
    {
      id: "add_idea",
      label: "Add idea",
      createInstance: {
        workflowId: "ideas",
        fields: [
          { key: "title", label: "Title", type: "string", required: true },
          { key: "category", label: "Category", type: "string" },
        ],
      },
    },
  ],
};
`;
    // Declared flowState source: validates clean.
    const ok = parseDefinition(
      base.replace("__SOURCE__", "taxonomy.categories")
    );
    assert.deepEqual(ok.findings, []);
    assert.deepEqual(validateFlowDefinition(ok.definition), []);

    // Source path whose first segment is not a declared flowState field.
    const bad = parseDefinition(base.replace("__SOURCE__", "nope.categories"));
    const errors = validateFlowDefinition(bad.definition);
    assert.ok(
      errors.some((e) =>
        e.message.includes(
          'optionsFrom.flowState references undeclared flowState field "nope"'
        )
      ),
      `expected an undeclared flowState source, got ${errors.map((e) => e.message).join("; ")}`
    );

    // Non-dotted path.
    const badPath = parseDefinition(base.replace("__SOURCE__", "taxonomy..x"));
    const pathErrors = validateFlowDefinition(badPath.definition);
    assert.ok(
      pathErrors.some((e) =>
        e.message.includes("optionsFrom.flowState must be a dotted path")
      ),
      `expected a dotted-path finding, got ${pathErrors.map((e) => e.message).join("; ")}`
    );
  });

  it("rejects a field declaring both static options and optionsFrom (E4)", () => {
    const module = `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "bothOptions",
  label: "Both Options",
  configSchema: [],
  flowState: [{ field: "taxonomy", type: "object" }],
  workflows: [
    {
      id: "ideas",
      label: "Ideas",
      instance: { title: "title" },
      editFields: [
        {
          key: "category",
          label: "Category",
          type: "string",
          options: ["a"],
          optionsFrom: { flowState: "taxonomy.categories" },
        },
      ],
      instanceState: [
        { field: "title", type: "string" },
        { field: "category", type: "string" },
      ],
      initial: "imported",
      terminalStates: ["imported"],
      states: [{ id: "imported", label: "Imported" }],
    },
  ],
  actions: [
    {
      id: "add_idea",
      label: "Add idea",
      createInstance: {
        workflowId: "ideas",
        fields: [{ key: "title", label: "Title", type: "string", required: true }],
      },
    },
  ],
};
`;
    const { definition } = parseDefinition(module);
    const errors = validateFlowDefinition(definition);
    assert.ok(
      errors.some((e) =>
        e.message.includes("declares both options and optionsFrom")
      ),
      `expected an options-conflict finding, got ${errors.map((e) => e.message).join("; ")}`
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
          flowState: () => ctx.flowState(),
          patchFlowState: ctx.patchFlowState,
          workflowInstancesInState: ctx.workflowInstancesInState,
          patchInstanceState: (instanceId, patch) =>
            ctx.patchSiblingInstanceState(instanceId, patch),
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

  it("rejects a closure-form module — the definition is the only artifact", async () => {
    // The retired compiled shape: no instanceState anchor (workflows carry the
    // erased workflowInstanceState), gates as closures. The loader must refuse
    // it — only the pure-data definition is a valid module now.
    const legacy = `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "legacyFlow",
  label: "Legacy Flow",
  configSchema: [],
  workflows: [{ id: "items", label: "Items" }],
  actions: [],
  edges: [],
};`;
    await assert.rejects(
      loadDefinitionFromSource("definition-seam-legacy", legacy, "legacy", {}),
      /not pure data/
    );
  });

  it("runs a cross-instance fixture: an op on the organizer patches a sibling idea by title, query filtered by workflow (E1+E6)", async () => {
    const module = `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "crossFixture",
  label: "Cross Fixture",
  configSchema: [],
  operations: [
    {
      id: "apply_classifications",
      ref: "./ops/apply.ts",
      writesAcross: [{ workflow: "ideas", fields: ["category"] }],
    },
  ],
  workflows: [
    {
      id: "organizer",
      label: "Organizer",
      instance: { title: "name" },
      instanceState: [
        { field: "name", type: "string" },
        { field: "backlogDigest", type: "string" },
      ],
      initial: "assembling",
      terminalStates: ["done"],
      states: [
        {
          id: "assembling",
          label: "Assembling",
          category: "initial",
          tasks: [
            {
              id: "assemble",
              label: "Assemble",
              role: "operation",
              operations: ["apply_classifications"],
            },
          ],
          autoTransitions: [
            { to: "done", gate: { kind: "taskSuccess", task: "assemble" } },
            { to: "failed", gate: { kind: "taskError", task: "assemble" } },
          ],
        },
        { id: "failed", label: "Failed", category: "error" },
        { id: "done", label: "Done", category: "terminal" },
      ],
    },
    {
      id: "ideas",
      label: "Ideas",
      instance: { title: "title" },
      display: { fields: [{ path: "category", label: "Category" }] },
      instanceState: [
        { field: "title", type: "string" },
        { field: "category", type: "string" },
      ],
      initial: "imported",
      terminalStates: ["imported"],
      states: [{ id: "imported", label: "Imported", category: "active" }],
    },
  ],
  edges: [],
  actions: [
    {
      id: "add_idea",
      label: "Add idea",
      createInstance: {
        workflowId: "ideas",
        fields: [{ key: "title", label: "Title", type: "string", required: true }],
      },
    },
    {
      id: "add_organizer",
      label: "Add organizer",
      createInstance: {
        workflowId: "organizer",
        fields: [{ key: "name", label: "Name", type: "string", required: true }],
      },
    },
  ],
};
`;
    const files: Record<string, string> = {
      "./ops/apply.ts": `import { defineOperations, type OperationContext } from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";

type OrganizerState = { name: string; backlogDigest: string };
type IdeaState = { title: string; category: string };

export const apply_classificationsOperations = defineOperations<OrganizerState>({
  apply_classifications: (
    _task: TaskDefinition,
    _params: Record<string, unknown>,
    ctx: OperationContext<OrganizerState>
  ) => {
    // The query now carries workflowId and filters by it (E6).
    const ideas = ctx.workflowInstancesInState("ideas");
    const target = ideas.find((i) => i.workflowInstanceState.title === "Ship a demo");
    if (!target) return { ok: false, count: ideas.length };
    // Cross-instance write (E1): patch the sibling idea's declared state.
    const ok = ctx.patchInstanceState(target.id, { category: "launch" });
    return { ok, count: ideas.length };
  },
});
`,
    };

    const loaded = await loadDefinitionFromSource(
      "cross-fixture",
      module,
      "crossFixture",
      files
    );
    if (!("workflows" in loaded.flow)) {
      throw new Error("expected a static definition");
    }
    const runtime = createFlowRuntime(
      "cross-flow",
      loaded.flow.workflows,
      loaded.flow.edges,
      operationRunners(loaded.flow),
      {},
      {},
      undefined
    );
    const idea = runtime.addWorkflowInstance("ideas", {
      workflowInstanceState: { title: "Ship a demo" },
    });
    runtime.addWorkflowInstance("ideas", {
      workflowInstanceState: { title: "Other idea" },
    });
    const organizer = runtime.addWorkflowInstance("organizer", {
      workflowInstanceState: { name: "brain" },
    });

    // The runtime query filters by workflow (E6) and carries workflowId.
    const ideasOnly = runtime.workflowInstancesInState("ideas");
    assert.equal(ideasOnly.length, 2);
    assert.ok(ideasOnly.every((p) => p.workflowId === "ideas"));

    await organizer.startAutoTasks();
    assert.equal(organizer.getState().currentState, "done");
    assert.equal(
      idea.getState().workflowInstanceState.category,
      "launch",
      "the organizer op patched the sibling idea's declared state"
    );
    // The other idea stayed untouched.
    assert.equal(
      runtime.getWorkflowInstanceEntries().find((e) => e.id !== idea.id)?.state
        .workflowInstanceState.category,
      undefined
    );
  });

  it("runs a flowState fixture: a publish op reads flowState and writes the taxonomy via patchFlowState (E2)", async () => {
    const module = `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "flowStateFixture",
  label: "FlowState Fixture",
  configSchema: [],
  flowState: [{ field: "taxonomy", type: "object" }],
  operations: [
    {
      id: "publish_taxonomy",
      ref: "./ops/publish.ts",
    },
  ],
  workflows: [
    {
      id: "organize",
      label: "Organize",
      instance: { title: "name" },
      instanceState: [{ field: "name", type: "string" }],
      initial: "publishing",
      terminalStates: ["done"],
      states: [
        {
          id: "publishing",
          label: "Publishing",
          category: "initial",
          tasks: [
            {
              id: "publish",
              label: "Publish",
              role: "operation",
              operations: ["publish_taxonomy"],
            },
          ],
          autoTransitions: [
            { to: "done", gate: { kind: "taskSuccess", task: "publish" } },
            { to: "failed", gate: { kind: "taskError", task: "publish" } },
          ],
        },
        { id: "failed", label: "Failed", category: "error" },
        { id: "done", label: "Done", category: "terminal" },
      ],
    },
  ],
  actions: [
    {
      id: "add_organizer",
      label: "Add organizer",
      createInstance: {
        workflowId: "organize",
        fields: [{ key: "name", label: "Name", type: "string", required: true }],
      },
    },
  ],
};
`;
    const files: Record<string, string> = {
      "./ops/publish.ts": `import { defineOperations, type OperationContext } from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";

type OrganizeState = { name: string };

export const publish_taxonomyOperations = defineOperations<OrganizeState>({
  publish_taxonomy: (
    _task: TaskDefinition,
    _params: Record<string, unknown>,
    ctx: OperationContext<OrganizeState>
  ) => {
    const existing = ctx.flowState().taxonomy;
    ctx.patchFlowState({ taxonomy: { categories: ["infra"], prior: existing } });
    return { ok: true, prior: existing };
  },
});
`,
    };

    const loaded = await loadDefinitionFromSource(
      "flowstate-fixture",
      module,
      "flowStateFixture",
      files
    );
    if (!("workflows" in loaded.flow)) {
      throw new Error("expected a static definition");
    }
    const runtime = createFlowRuntime(
      "flowstate-flow",
      loaded.flow.workflows,
      loaded.flow.edges,
      operationRunners(loaded.flow),
      {},
      { taxonomy: { categories: [] } },
      undefined
    );
    const organizer = runtime.addWorkflowInstance("organize", {
      workflowInstanceState: { name: "brain" },
    });
    // The instance auto-starts its initial-state auto tasks on creation; poll
    // until the publish op's success transition lands.
    for (let i = 0; i < 200; i++) {
      if (organizer.getState().currentState === "done") break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(organizer.getState().currentState, "done");
    assert.deepEqual(runtime.getFlowState().taxonomy, {
      categories: ["infra"],
      prior: { categories: [] },
    });
  });

  it("rejects a toFlowState edge whose transform writes an undeclared flowState field (E2)", async () => {
    const module = `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "badFlowStateEdge",
  label: "Bad FlowState Edge",
  configSchema: [],
  flowState: [{ field: "taxonomy", type: "object" }],
  workflows: [
    {
      id: "source",
      label: "Source",
      instanceState: [],
      initial: "done",
      terminalStates: ["done"],
      states: [{ id: "done", label: "Done", category: "terminal" }],
    },
  ],
  edges: [
    {
      fromWorkflow: "source",
      fromStates: ["done"],
      toFlowState: true,
      transform: { ref: "./edges/to-state.ts", fields: ["bogusField"] },
    },
  ],
};
`;
    const files: Record<string, string> = {
      "./edges/to-state.ts": `import type { TransformContract } from "workflow-engine/workflow-types";

export const toState: TransformContract = () => ({ bogusField: 1 });
`,
    };
    await assert.rejects(
      loadDefinitionFromSource(
        "bad-flowstate-edge",
        module,
        "badFlowStateEdge",
        files
      ),
      /toFlowState edge transform writes "bogusField" which is not declared in flowState/
    );
  });

  it("rejects a writesAcross declaration that targets an undeclared field", async () => {
    const module = `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "badAcross",
  label: "Bad Across",
  configSchema: [],
  operations: [
    {
      id: "cross",
      ref: "./ops/cross.ts",
      writesAcross: [{ workflow: "ideas", fields: ["nope"] }],
    },
  ],
  workflows: [
    {
      id: "ideas",
      label: "Ideas",
      instanceState: [{ field: "title", type: "string" }],
      initial: "imported",
      terminalStates: ["imported"],
      states: [{ id: "imported", label: "Imported" }],
    },
  ],
};
`;
    const files: Record<string, string> = {
      "./ops/cross.ts": `import { defineOperations } from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import type { OperationContext } from "workflow-engine/runners";

export const crossOperations = defineOperations({
  cross: (
    _task: TaskDefinition,
    _params: Record<string, unknown>,
    ctx: OperationContext
  ) => ctx.patchInstanceState("x", { nope: "y" }),
});
`,
    };
    await assert.rejects(
      loadDefinitionFromSource("bad-across", module, "badAcross", files),
      /nope.*not declared in target workflow "ideas" instanceState/
    );
  });
});

// A completionOutput task nobody reads, with no referenced files that could
// read it: the discarded-output advisory must fire.
const DISCARDED_MODULE = `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "discardedFlow",
  label: "Discarded Flow",
  configSchema: [],
  workflows: [
    {
      id: "items",
      label: "Items",
      instanceState: [{ field: "note", type: "string" }],
      initial: "new",
      terminalStates: ["done"],
      states: [
        {
          id: "new",
          label: "New",
          category: "initial",
          tasks: [
            {
              id: "research",
              label: "Research",
              role: "ai-task",
              systemPrompt: "Research and call the completion tool.",
              completionOutput: [{ field: "note", type: "string" }],
            },
          ],
          autoTransitions: [
            { to: "done", gate: { kind: "taskSuccess", task: "research" } },
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
      createInstance: { workflowId: "items", fields: [] },
    },
  ],
  edges: [],
};
`;

// A workflow whose task outputs can be read from inside referenced files: a
// flow-level custom operation used by a task (its executor receives
// taskOutputs) and an edge transform from the workflow (the transform
// receives the source task outputs).
const FILE_READER_MODULE = `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "fileReaderFlow",
  label: "File Reader Flow",
  configSchema: [],
  operations: [{ id: "persist", ref: "./ops/persist.ts", writes: [] }],
  workflows: [
    {
      id: "items",
      label: "Items",
      instanceState: [{ field: "note", type: "string" }],
      initial: "new",
      terminalStates: ["done"],
      states: [
        {
          id: "new",
          label: "New",
          category: "initial",
          tasks: [
            {
              id: "research",
              label: "Research",
              role: "ai-task",
              systemPrompt: "Research and call the completion tool.",
              completionOutput: [{ field: "note", type: "string" }],
            },
            {
              id: "persistNote",
              label: "Persist note",
              role: "operation",
              operations: ["persist"],
            },
          ],
          autoTransitions: [
            { to: "done", gate: { kind: "taskSuccess", task: "persistNote" } },
          ],
        },
        { id: "done", label: "Done", category: "terminal" },
      ],
    },
  ],
  actions: [],
  edges: [
    {
      fromWorkflow: "items",
      fromStates: ["done"],
      toWorkflow: "items",
      transform: { ref: "./edges/to-note.ts", fields: ["note"] },
    },
  ],
};
`;

// ─── definition expressiveness ───────────────────────────────────────

// A definition carrying the expressive vocabulary — a custom render kind
// (ui.kinds), a task render hint, a flow-level ui.view, and a file gate —
// validates and compiles. The definition expresses these as data; nothing
// requires a hand-off to a human.
const EXPRESSIVE_MODULE = `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "expressiveFlow",
  label: "Expressive Flow",
  configSchema: [],
  ui: { view: "list", kinds: [{ kind: "score", contract: { props: [] } }] },
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
              id: "score",
              label: "Score",
              role: "ai-task",
              systemPrompt: "Score the item, then complete.",
              completionOutput: [{ field: "outcome", type: "string" }],
              render: { kind: "score", props: { content: "output.outcome" } },
            },
          ],
          autoTransitions: [
            { to: "done", gate: { kind: "file", ref: "./gates/approved.ts" } },
          ],
        },
        { id: "done", label: "Done", category: "terminal" },
      ],
    },
  ],
  edges: [],
};
`;

const EXPRESSIVE_FILES: Record<string, string> = {
  "./gates/approved.ts": `import type { GateContract } from "workflow-engine/workflow-types";
export const approved: GateContract = (ctx) =>
  ctx.workflowInstanceState.verdict === "approved";
`,
};

describe("definition expressiveness (custom render kinds, task render hints, ui.view, file gates)", () => {
  it("a definition with a custom render kind, a task render hint, a flow-level ui.view, and a file gate validates and compiles", async () => {
    const { definition, findings } = parseDefinition(EXPRESSIVE_MODULE);
    assert.deepEqual(findings, []);
    assert.deepEqual(validateFlowDefinition(definition), []);
    assert.equal(definition.ui?.view, "list");
    assert.equal(definition.ui?.kinds?.[0]?.kind, "score");
    assert.deepEqual(definition.workflows[0]?.states[0]?.tasks?.[0]?.render, {
      kind: "score",
      props: { content: "output.outcome" },
    });

    const loaded = await loadDefinitionFromSource(
      "definition-expressive",
      EXPRESSIVE_MODULE,
      "expressiveFlow",
      EXPRESSIVE_FILES
    );
    assert.ok("workflows" in loaded.flow);
    const task = loaded.flow.workflows[0]?.states[0]?.tasks?.[0];
    assert.deepEqual(task?.render, {
      kind: "score",
      props: { content: "output.outcome" },
    });
    assert.equal(loaded.flow.ui?.view, "list");
  });
});

// ─── honeycomb preset end-to-end (the definition corpus acceptance test) ──
// Fixture backlog → parse → taxonomy proposal → approve → global classify →
// map.md. The ai-tasks run against a mock model caller that completes each
// task's generated completion tool; the operations run the compiled ops.

describe("honeycomb preset runs the full pipeline (paste → approve → classify → map)", () => {
  const PRESET_SLUG = "honeycomb";

  function runners(compiled: CompiledFlowDefinition) {
    const standardDefs = createStandardToolDefinitions();
    const standardExecs = createStandardToolRegistry();
    const domainMaps = toToolMaps(compiled.tools ?? []);

    const operationContext = (ctx: TaskRunnerContext) => ({
      flowConfig: () => ctx.flowConfig,
      patchFlowConfig: ctx.patchFlowConfig,
      instanceId: ctx.instanceId,
      workflowId: ctx.workflowId,
      currentState: ctx.currentState,
      workflowInstanceState: () => ctx.workflowInstanceState(),
      taskOutputs: () => ctx.taskOutputs,
      patchWorkflowInstanceState: ctx.patchWorkflowInstanceState,
      flowState: () => ctx.flowState(),
      patchFlowState: ctx.patchFlowState,
      workflowInstancesInState: ctx.workflowInstancesInState,
      patchInstanceState: (
        instanceId: string,
        patch: Record<string, unknown>
      ) => ctx.patchSiblingInstanceState(instanceId, patch),
    });

    return {
      operation: (ctx: TaskRunnerContext) =>
        createOperationRunner({
          operations: compiled.operations ?? {},
          getContext: () => operationContext(ctx),
        }),
      "ai-task": (ctx: TaskRunnerContext) =>
        createAiTaskRunner({
          modelCaller: async (_prompt, _messages, tools) => {
            const completion = tools.find((t) =>
              t.function.name.endsWith("_complete")
            );
            const name = completion?.function.name ?? "complete";
            const args = JSON.stringify(COMPLETIONS[name] ?? {});
            return {
              content: "done",
              toolCalls: [{ id: "c1", name, arguments: args }],
            };
          },
          toolDefinitions: { ...standardDefs, ...domainMaps.definitions },
          toolExecutors: { ...standardExecs, ...domainMaps.executors },
          basePath: readBasePath(ctx),
          instanceId: ctx.instanceId,
          workflowInstanceState: ctx.workflowInstanceState,
          flowState: () => ctx.flowState(),
          patchRunningTaskStatus: ctx.patchRunningTaskStatus,
          createWorkflowInstance: ctx.createWorkflowInstance,
        }),
    };
  }

  function readBasePath(ctx: TaskRunnerContext): string | undefined {
    const basePath = ctx.flowConfig.basePath;
    return typeof basePath === "string" && basePath !== ""
      ? basePath
      : undefined;
  }

  async function waitFor(
    runtime: ReturnType<typeof createFlowRuntime>,
    condition: (
      entries: ReturnType<
        ReturnType<typeof createFlowRuntime>["getWorkflowInstanceEntries"]
      >
    ) => boolean,
    label: string
  ): Promise<void> {
    for (let i = 0; i < 500; i++) {
      if (condition(runtime.getWorkflowInstanceEntries())) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`timeout waiting for ${label}`);
  }

  it("imports → fan-out → taxonomy → approve → classify → map.md", async () => {
    const root = mkdtempSync(join(tmpdir(), "hive-honeycomb-"));
    const loaded = await loadPresetDefinition(PRESET_SLUG);
    if (!("workflows" in loaded.flow)) {
      throw new Error("expected a static definition");
    }
    const runtime = createFlowRuntime(
      "honeycomb-flow",
      loaded.flow.workflows,
      loaded.flow.edges,
      runners(loaded.flow),
      { definitionId: "honeycomb", basePath: root },
      {},
      undefined
    );

    // Paste a backlog: the imports instance auto-runs prepare_input → parse
    // (mock splits two ideas) → recordIdeas → done, and the fan-out edge
    // creates one idea card per chunk.
    runtime.addWorkflowInstance("imports", {
      workflowInstanceState: {
        name: "TODOs dump",
        source: "todos",
        rawText:
          "- Ship a demo\n- Rewrite the onboarding copy\n- Fix the search debounce",
      },
    });
    await waitFor(
      runtime,
      (entries) => entries.filter((e) => e.workflowId === "ideas").length === 3,
      "idea cards from the fan-out edge"
    );

    // Start organizing: assemble digest → taxonomize (mock taxonomy) →
    // taxonomy_proposed.
    const organizer = runtime.addWorkflowInstance("organize", {
      workflowInstanceState: { name: "Organizer" },
    });
    await waitFor(
      runtime,
      (entries) =>
        entries.some(
          (e) =>
            e.id === organizer.id &&
            e.state.currentState === "taxonomy_proposed"
        ),
      "taxonomy proposal"
    );

    // One click approves; publish → classify (mock classifications applied
    // onto the cards by title via E1) → build map.md → done.
    organizer.dispatchAction("approve");
    await waitFor(
      runtime,
      (entries) =>
        entries.some(
          (e) => e.id === organizer.id && e.state.currentState === "done"
        ),
      "organize done"
    );

    // Every idea card received its classification on its own state.
    const ideaEntries = runtime
      .getWorkflowInstanceEntries()
      .filter((e) => e.workflowId === "ideas");
    assert.equal(ideaEntries.length, 3);
    const classifications = (
      COMPLETIONS.organize_classifyAll_complete as {
        classifications: Array<{ title: string; category: string }>;
      }
    ).classifications;
    for (const entry of ideaEntries) {
      const expected = classifications.find(
        (c) => c.title === entry.state.workflowInstanceState.title
      );
      assert.equal(
        entry.state.workflowInstanceState.category,
        expected?.category,
        `card ${entry.state.workflowInstanceState.title} got its category`
      );
      assert.ok(
        Array.isArray(entry.state.workflowInstanceState.dependents),
        "dependents are computed per card"
      );
    }
    // flowState carries the approved taxonomy (E2), not duplicated on cards.
    const state = runtime.getFlowState() as {
      taxonomy?: { categories?: unknown };
    };
    assert.deepEqual(state.taxonomy?.categories, [
      { name: "delivery", definition: "Shippable product work" },
      { name: "polish", definition: "Quality and copy" },
    ]);

    // E3: the ideas board declares field-value grouping by category.
    const ideasDef = runtime
      .getWorkflowDefinitions()
      .find((d) => d.id === "ideas");
    assert.equal(ideasDef?.ui?.groupByField, "category");

    // E4: the category edit field's options resolve from flowState's taxonomy.
    const ideasEntries = runtime
      .getWorkflowInstanceEntries()
      .filter((e) => e.workflowId === "ideas");
    const categoryField = ideasEntries[0]?.editFields.find(
      (f) => f.key === "category"
    );
    assert.deepEqual(categoryField?.options, ["delivery", "polish"]);
    assert.equal(categoryField?.optionsFrom, undefined);

    // map.md is persisted to the domain dir.
    const mapPath = join(root, ".honeycomb", "map.md");
    const map = readFileSync(mapPath, "utf-8");
    assert.ok(map.includes("# Ideas Map"), "map.md header");
    assert.ok(map.includes("Ship a demo"), "map lists the idea");
    assert.ok(map.includes("## delivery"), "map groups by category");

    rmSync(root, { recursive: true, force: true });
  });
});

// The mock model's completions per generated completion tool.
const COMPLETIONS: Record<string, unknown> = {
  imports_parse_complete: {
    ideas: [
      { title: "Ship a demo", text: "- Ship a demo", source: "todos" },
      {
        title: "Rewrite onboarding copy",
        text: "- Rewrite the onboarding copy",
        source: "todos",
      },
      {
        title: "Fix search debounce",
        text: "- Fix the search debounce",
        source: "todos",
      },
    ],
  },
  organize_taxonomize_complete: {
    categories: [
      { name: "delivery", definition: "Shippable product work" },
      { name: "polish", definition: "Quality and copy" },
    ],
    priorityScale: { levels: [{ key: "p0" }, { key: "p1" }, { key: "p2" }] },
    effortScale: { levels: [{ key: "S" }, { key: "M" }, { key: "L" }] },
    dedupPolicy: "the same ask restated",
  },
  organize_classifyAll_complete: {
    classifications: [
      {
        title: "Ship a demo",
        category: "delivery",
        tags: ["demo"],
        priority: "p0",
        effort: "M",
        status: "backlog",
        dependsOn: [],
        duplicateOf: "",
        summary: "Ship the demo.",
        rationale: "Shippable work.",
      },
      {
        title: "Rewrite onboarding copy",
        category: "polish",
        tags: ["copy"],
        priority: "p1",
        effort: "S",
        status: "backlog",
        dependsOn: [],
        duplicateOf: "",
        summary: "Rewrite the copy.",
        rationale: "Quality and copy.",
      },
      {
        title: "Fix search debounce",
        category: "delivery",
        tags: ["search"],
        priority: "p1",
        effort: "S",
        status: "backlog",
        dependsOn: ["Ship a demo"],
        duplicateOf: "",
        summary: "Fix the debounce.",
        rationale: "Shippable work.",
      },
    ],
  },
  ideas_classify_complete: {
    category: "delivery",
    tags: ["manual"],
    priority: "p1",
    effort: "M",
    status: "backlog",
    summary: "A manually added idea.",
  },
};
