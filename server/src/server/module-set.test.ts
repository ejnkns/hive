// The module-set seam: a pure-data definition with file references goes
// validate (the definition validator) → materialize → lint → import policy →
// typecheck → declared-writes verification → load (import → validate →
// compile) → execute in a real FlowRuntime. Malformed references produce
// specific, model-actionable findings; a valid set executes with the custom
// code behaving — the custom gate decides a transition, the custom tool
// returns its shaped result (the primitive transport is the test's stubbed
// executor), and the custom operation/transform/extract all run.

import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { collectDefinitionRefs } from "workflow-engine/compile-flow-definition";
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
import { parseDefinition } from "./flow-definition.ts";
import {
  registerUserDefinition,
  resetFlowDefinitionsForTest,
  setDefinitionsBasePathForTest,
} from "./flow-definitions.ts";
import { lintModuleSet, runDefinitionModuleGate } from "./module-set.ts";
import { presetRoot, readPresetModuleSetFiles } from "./preset-flow.ts";

// ─── the five-kind definition module ──────────────────────────────────

// A research flow whose gates, tool, operations, edge transform, and output
// extractor are all referenced files. The test implements the refs and runs
// the whole thing in a real FlowRuntime.
const FIVE_KIND_MODULE = `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
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
      initial: "ready",
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
`;

// The parsed data definition (the gate and the loader consume the object).
const FIVE_KIND = parseDefinition(FIVE_KIND_MODULE).definition;

// ─── implemented refs (the "implement the stub" step) ────────────────

const IMPLEMENTED_GATE = `import type { GateContract } from "workflow-engine/workflow-types";

export const approved: GateContract = (ctx) => {
  return ctx.workflowInstanceState.verdict === "approved";
};
`;

const IMPLEMENTED_TOOL = `import { defineTool } from "workflow-engine/runners";

export const websearchTools = [
  defineTool({
    name: "websearch",
    description: "Search the web and return the top result.",
    parameters: {
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    executor: async (call) => {
      return {
        toolCallId: call.id,
        content: JSON.stringify({ title: "Hive docs", snippet: "good result" }),
        isError: false,
      };
    },
  }),
];
`;

const IMPLEMENTED_SCORE = `import { defineOperations, type OperationContext } from "workflow-engine/runners";

export const scoreOperations = defineOperations<Record<string, unknown>>({
  score: (task, params, ctx: OperationContext) => {
    return { score: 7 };
  },
});
`;

const IMPLEMENTED_ANNOTATE = `import { defineOperations, type OperationContext } from "workflow-engine/runners";

export const annotateOperations = defineOperations<Record<string, unknown>>({
  annotate: (task, params, ctx: OperationContext) => {
    return { ok: true };
  },
});
`;

const IMPLEMENTED_TRANSFORM = `import type { TransformContract } from "workflow-engine/workflow-types";

export const toSummary: TransformContract = (source) => {
  const search = source.search as { output?: { completion?: { summary?: string } } } | undefined;
  return { title: "Summary", body: search?.output?.completion?.summary ?? "" };
};
`;

const IMPLEMENTED_EXTRACT = `import type { OutputExtractor } from "workflow-engine/workflow-types";

export const parseResult: OutputExtractor = (ctx) => {
  const search = ctx.taskOutputs.search as { output?: { completion?: { summary?: string } } } | undefined;
  const summary = search?.output?.completion?.summary ?? "";
  return { verdict: summary.includes("good") ? "approved" : "needs_review" };
};
`;

const IMPLEMENTED_FILES: Record<string, string> = {
  "./tools/websearch.ts": IMPLEMENTED_TOOL,
  "./ops/score.ts": IMPLEMENTED_SCORE,
  "./ops/annotate.ts": IMPLEMENTED_ANNOTATE,
  "./edges/to-summary.ts": IMPLEMENTED_TRANSFORM,
  "./extractors/parse-result.ts": IMPLEMENTED_EXTRACT,
  "./gates/approved.ts": IMPLEMENTED_GATE,
};

// A tool whose executor patches an instance-state field its writes do not
// declare (declarations can lie — the gate must catch it).
const IMPLEMENTED_TOOL_UNDECLARED_WRITE = `import { defineTool } from "workflow-engine/runners";

export const websearchTools = [
  defineTool({
    name: "websearch",
    description: "Search the web.",
    parameters: { properties: { query: { type: "string" } }, required: ["query"] },
    executor: async (call, ctx) => {
      ctx.patchWorkflowInstanceState?.({ verdict: "tampered" });
      return { toolCallId: call.id, content: "ok", isError: false };
    },
  }),
];
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
function searchScript() {
  let turn = 0;
  return async (): Promise<{ content: string; toolCalls?: ToolCall[] }> => {
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
  flow: Awaited<ReturnType<typeof runDefinitionModuleGate>>["flow"],
  modelCaller: ReturnType<typeof searchScript>
) {
  if (!flow || !("workflows" in flow)) {
    throw new Error(
      "expected a static compiled definition, got a buildWorkflows factory"
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

// ─── tests ────────────────────────────────────────────────────────────

describe("module-set pipeline (definition modules)", () => {
  it("lints an implemented definition clean and reports a missing referenced file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hive-module-set-"));
    const emptyDir = mkdtempSync(join(tmpdir(), "hive-module-set-empty-"));
    try {
      await writeModuleSetFiles(dir, IMPLEMENTED_FILES);
      const clean = lintModuleSet(collectDefinitionRefs(FIVE_KIND), dir);
      assert.deepEqual(clean, []);

      // A reference with no file on disk (a fresh empty dir): the lint
      // reports it specifically.
      const findings = lintModuleSet(
        collectDefinitionRefs(FIVE_KIND),
        emptyDir
      );
      assert.ok(
        findings.some((f) => f.message.includes("does not exist")),
        `expected a missing-file finding, got ${JSON.stringify(findings)}`
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("reports a ref escaping the definition root and a misnamed export", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hive-module-set-"));
    try {
      mkdirSync(join(dir, "gates"), { recursive: true });
      writeFileSync(join(dir, "gates", "approved.ts"), IMPLEMENTED_GATE);
      writeFileSync(join(dir, "gates", "renamed.ts"), IMPLEMENTED_GATE);

      // The escaping ref: a transform pointing outside the root.
      const escaping = {
        ...FIVE_KIND,
        edges: [
          {
            fromWorkflow: "research",
            fromStates: ["done"],
            toWorkflow: "summary",
            transform: {
              ref: "../escape.ts",
              fields: ["title", "body"],
            },
          },
        ],
      };
      const findings = lintModuleSet(collectDefinitionRefs(escaping), dir);
      assert.ok(
        findings.some((f) => f.message.includes("outside the definition root")),
        `expected an escaping-ref finding, got ${JSON.stringify(findings)}`
      );

      // A missing export (the file exists but exports a different name).
      const missingExport = {
        ...FIVE_KIND,
        edges: [
          {
            fromWorkflow: "research",
            fromStates: ["done"],
            toWorkflow: "summary",
            transform: {
              ref: "./gates/renamed.ts",
              fields: ["title", "body"],
            },
          },
        ],
      };
      const exportFindings = lintModuleSet(
        collectDefinitionRefs(missingExport),
        dir
      );
      assert.ok(
        exportFindings.some((f) => f.message.includes("does not export")),
        `expected a missing-export finding, got ${JSON.stringify(exportFindings)}`
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the full gate passes for an implemented set and executes in a real FlowRuntime", async () => {
    const result = await runDefinitionModuleGate(
      "module-set-seam",
      FIVE_KIND,
      FIVE_KIND_MODULE,
      IMPLEMENTED_FILES
    );
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
    assert.ok(result.flow, "the gate must load (compile) the definition");
    assert.ok(
      result.files["./gates/approved.ts"]?.includes("GateContract"),
      "the gate returns the current file set"
    );

    // Execute: the custom tool runs, the custom gate decides the transition,
    // the patch op records the score, the extractor writes the verdict.
    const runtime = buildRuntime(result.flow, searchScript());
    const instance = runtime.addWorkflowInstance("research", {
      workflowInstanceState: { query: "hive" },
    });
    instance.startAutoTasks();
    // The search task is an interactive ai-chat session (startOnUserInput);
    // release it with the query.
    instance.sendTaskInput("search", "find hive", "user");
    await waitFor(
      () =>
        instance.getState().currentState === "done" &&
        instance.getState().workflowInstanceState.verdict === "approved"
    );
    const state = instance.getState();
    assert.equal(state.workflowInstanceState.score, 7);
    assert.equal(
      state.workflowInstanceState.result,
      "good result",
      "the patch op recorded the completion summary"
    );
    const transcript = JSON.stringify(state.taskOutputs?.search?.output ?? {});
    assert.ok(
      transcript.includes("Hive docs"),
      "the custom websearch tool returned its shaped result"
    );

    // The edge transform runs on terminal: a summary instance is created.
    await waitFor(
      () =>
        runtime
          .getWorkflowInstanceEntries()
          .some((e) => e.workflowId === "summary"),
      3000
    );
    const summary = runtime
      .getWorkflowInstanceEntries()
      .find((e) => e.workflowId === "summary");
    assert.equal(summary?.state.workflowInstanceState.body, "good result");
  });

  it("rejects a tool executor writing an undeclared instance-state field (declarations can lie)", async () => {
    const result = await runDefinitionModuleGate(
      "module-set-writes",
      FIVE_KIND,
      FIVE_KIND_MODULE,
      {
        ...IMPLEMENTED_FILES,
        "./tools/websearch.ts": IMPLEMENTED_TOOL_UNDECLARED_WRITE,
      }
    );
    assert.ok(
      result.errors.some(
        (e) =>
          e.includes("verdict") &&
          e.includes("not declared in the tool's writes")
      ),
      `expected a declared-writes finding, got ${JSON.stringify(result.errors)}`
    );
  });

  it("registers a module-set definition whose record carries the data form and the file set", async () => {
    const defsDir = mkdtempSync(join(tmpdir(), "hive-module-set-"));
    setDefinitionsBasePathForTest(defsDir);
    resetFlowDefinitionsForTest();
    try {
      const record = await registerUserDefinition({
        name: "Module Set Flow",
        source: FIVE_KIND_MODULE,
        files: IMPLEMENTED_FILES,
      });
      assert.equal(record.id, "module-set-flow");
      assert.equal(record.definition?.id, "moduleSetFlow");
      assert.ok(
        record.files?.["./gates/approved.ts"]?.includes("GateContract"),
        "the record stores the referenced file set"
      );
      assert.ok("workflows" in record.flow);
    } finally {
      rmSync(defsDir, { recursive: true, force: true });
      resetFlowDefinitionsForTest();
    }
  });

  it("the gate refuses a definition whose referenced file imports an undeclared package; declaring it passes", async () => {
    const TOOL_IMPORTING_LRU = `import { defineTool } from "workflow-engine/runners";
import { LRUCache } from "lru-cache";

export const websearchTools = [
  defineTool({
    name: "websearch",
    description: "Search.",
    parameters: { properties: {}, required: [] },
    executor: async (call) => ({ toolCallId: call.id, content: "ok", isError: false }),
  }),
];
`;
    const rejected = await runDefinitionModuleGate(
      "module-set-imports",
      FIVE_KIND,
      FIVE_KIND_MODULE,
      { ...IMPLEMENTED_FILES, "./tools/websearch.ts": TOOL_IMPORTING_LRU }
    );
    assert.ok(
      rejected.errors.some(
        (e) => /lru-cache/.test(e) && /dependencies/.test(e)
      ),
      `expected a dependency finding, got ${JSON.stringify(rejected.errors)}`
    );

    const withDependency = {
      ...FIVE_KIND,
      dependencies: ["lru-cache"],
    };
    const passed = await runDefinitionModuleGate(
      "module-set-imports-ok",
      withDependency,
      FIVE_KIND_MODULE,
      { ...IMPLEMENTED_FILES, "./tools/websearch.ts": TOOL_IMPORTING_LRU }
    );
    assert.deepEqual(passed.errors, []);
  });

  it("the built-in presets pass the full gate (lint, imports, typecheck, writes, load)", async () => {
    for (const presetName of ["queen-bee", "wayfinder"]) {
      const source = readFileSync(
        join(presetRoot(presetName), "flow.ts"),
        "utf-8"
      );
      const { definition, findings } = parseDefinition(source);
      assert.deepEqual(findings, [], `${presetName} parse findings`);
      const result = await runDefinitionModuleGate(
        `preset-gate-${presetName}`,
        definition,
        source,
        readPresetModuleSetFiles(presetName)
      );
      assert.deepEqual(result.errors, [], `${presetName} gate errors`);
      assert.ok(result.flow, `${presetName} must load (compile)`);
    }
  });
});

// Writes a module set's files into a temp dir (the lint tests check the
// files on disk without running the full gate).
async function writeModuleSetFiles(
  dir: string,
  files: Record<string, string>
): Promise<string> {
  for (const [ref, source] of Object.entries(files)) {
    const target = join(dir, ref.replace(/^\.\//, ""));
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, source, "utf-8");
  }
  return dir;
}
