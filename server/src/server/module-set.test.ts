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
    instanceId: ctx.instanceId,
    workflowId: ctx.workflowId,
    currentState: ctx.currentState,
    workflowInstanceState: ctx.workflowInstanceState,
    taskOutputs: () => ctx.taskOutputs,
    flowState: () => ctx.flowState(),
    patchFlowState: ctx.patchFlowState,
    patchInstanceState: (instanceId, patch) =>
      ctx.patchSiblingInstanceState(instanceId, patch),
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
        basePath: join(tmpdir(), "hive-module-set"),
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

describe("module-set components (served modules)", () => {
  // A definition declaring a ref-form served component (the primary
  // authoring path): the module is a module-set member with the same
  // lifecycle as a tool/operation file — linted, import-policied,
  // typechecked, and loadable.
  const COMPONENT_MODULE = `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "componentModuleFlow",
  label: "Component Module Flow",
  configSchema: [],
  ui: {
    components: {
      "ticket-card": { ref: "./ui/ticket-card.ts" },
    },
  },
  workflows: [
    {
      id: "tickets",
      label: "Tickets",
      instanceState: [],
      initial: "new",
      terminalStates: ["done"],
      states: [
        { id: "new", label: "New", category: "initial" },
        { id: "done", label: "Done", category: "terminal" },
      ],
    },
  ],
  edges: [],
};
`;
  const COMPONENT_DEFINITION = parseDefinition(COMPONENT_MODULE).definition;

  // A contract-clean component module: default-export factory, type-only
  // imports from the allowlist (lit + the engine contract types).
  const IMPLEMENTED_COMPONENT = `import type { LitElement } from "lit";
import type {
  FlowComponentDeps,
  FlowComponentRegistrations,
} from "workflow-engine/workflow-types";

export default function (lit: FlowComponentDeps): FlowComponentRegistrations {
  const { LitElement: Base, html } = lit;
  class TicketCard extends Base {
    render() {
      return html\`<div class="ticket">ticket</div>\`;
    }
  }
  return { components: { "ticket-card": TicketCard } };
}
`;

  it("lints a component module clean and reports a missing default export", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hive-module-set-"));
    try {
      await writeModuleSetFiles(dir, {
        "./ui/ticket-card.ts": IMPLEMENTED_COMPONENT,
      });
      const clean = lintModuleSet(
        collectDefinitionRefs(COMPONENT_DEFINITION),
        dir
      );
      assert.deepEqual(clean, []);

      // The file exists but has no default export: the lint reports it.
      await writeModuleSetFiles(dir, {
        "./ui/ticket-card.ts": "export const notAFactory = 42;\n",
      });
      const findings = lintModuleSet(
        collectDefinitionRefs(COMPONENT_DEFINITION),
        dir
      );
      assert.ok(
        findings.some((f) => f.message.includes("default export")),
        `expected a default-export finding, got ${JSON.stringify(findings)}`
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a component module with a bare value import (only module-set files may be value-imported)", async () => {
    const VALUE_IMPORT_COMPONENT = `import { LitElement } from "lit";

export default function (lit) {
  return { components: {} };
}
`;
    const result = await runDefinitionModuleGate(
      "module-set-component-value-import",
      COMPONENT_DEFINITION,
      COMPONENT_MODULE,
      { "./ui/ticket-card.ts": VALUE_IMPORT_COMPONENT }
    );
    assert.ok(
      result.errors.some(
        (e) => e.includes("ticket-card.ts") && e.includes("value import")
      ),
      `expected a value-import finding, got ${JSON.stringify(result.errors)}`
    );
  });

  it("passes a component module whose entry value-imports a sibling module-set file (the multi-file pattern)", async () => {
    const MULTIFILE_ENTRY = `import { ticketTitle } from "./ticket-title.ts";
import type { LitElement } from "lit";
import type {
  FlowComponentDeps,
  FlowComponentRegistrations,
} from "workflow-engine/workflow-types";

export default function (lit: FlowComponentDeps): FlowComponentRegistrations {
  const { LitElement: Base, html } = lit;
  class TicketCard extends Base {
    render() {
      return html\`<div class="ticket">\${ticketTitle("ticket")}</div>\`;
    }
  }
  return { components: { "ticket-card": TicketCard } };
}
`;
    const result = await runDefinitionModuleGate(
      "module-set-component-multifile",
      COMPONENT_DEFINITION,
      COMPONENT_MODULE,
      {
        "./ui/ticket-card.ts": MULTIFILE_ENTRY,
        "./ui/ticket-title.ts": `export function ticketTitle(raw: string): string {
  return raw.trim().toUpperCase();
}
`,
      }
    );
    assert.deepEqual(result.errors, [], `got ${JSON.stringify(result.errors)}`);
  });

  // The component closure is the browser module set: a sibling file a
  // component entry value-imports runs in the browser too, so node builtins,
  // engine code, and undeclared packages are rejected there even though the
  // same imports are legal for non-closure module-set files.
  it("rejects a closure file's node builtin value import", async () => {
    const result = await runDefinitionModuleGate(
      "module-set-closure-node",
      COMPONENT_DEFINITION,
      COMPONENT_MODULE,
      {
        "./ui/ticket-card.ts": `import { labelFor } from "./labels.ts";

export default function (lit) {
  return { components: {} };
}
`,
        "./ui/labels.ts": `import { readFileSync } from "node:fs";

export function labelFor(input: string): string {
  return readFileSync(input, "utf-8");
}
`,
      }
    );
    assert.ok(
      result.errors.some(
        (e) => e.includes("ui/labels.ts") && e.includes("value import")
      ),
      `expected a closure value-import finding, got ${JSON.stringify(result.errors)}`
    );
  });

  it("rejects a closure file's engine value import (workflow-engine is server-side)", async () => {
    const result = await runDefinitionModuleGate(
      "module-set-closure-engine",
      COMPONENT_DEFINITION,
      COMPONENT_MODULE,
      {
        "./ui/ticket-card.ts": `import { loadIcon } from "./labels.ts";

export default function (lit) {
  return { components: {} };
}
`,
        "./ui/labels.ts": `import { defineTool } from "workflow-engine/runners";

export function loadIcon(input: string): string {
  return input;
}
`,
      }
    );
    assert.ok(
      result.errors.some(
        (e) => e.includes("ui/labels.ts") && e.includes("value import")
      ),
      `expected a closure value-import finding, got ${JSON.stringify(result.errors)}`
    );
  });

  it("rejects a closure file's undeclared package value import", async () => {
    const result = await runDefinitionModuleGate(
      "module-set-closure-dep",
      COMPONENT_DEFINITION,
      COMPONENT_MODULE,
      {
        "./ui/ticket-card.ts": `import { labelFor } from "./labels.ts";

export default function (lit) {
  return { components: {} };
}
`,
        "./ui/labels.ts": `import { LRUCache } from "lru-cache";

export function labelFor(input: string): string {
  return input;
}
`,
      }
    );
    assert.ok(
      result.errors.some(
        (e) => e.includes("ui/labels.ts") && e.includes("value import")
      ),
      `expected a closure value-import finding, got ${JSON.stringify(result.errors)}`
    );
  });

  it("keeps a non-closure module-set file's normal import policy in a mixed set", async () => {
    const result = await runDefinitionModuleGate(
      "module-set-mixed",
      COMPONENT_DEFINITION,
      COMPONENT_MODULE,
      {
        "./ui/ticket-card.ts": `import type { FlowComponentDeps } from "workflow-engine/workflow-types";

export default function (lit: FlowComponentDeps) {
  return { components: {} };
}
`,
        // A sibling the component never imports: it stays out of the browser
        // closure and keeps the normal module-set policy (node builtins OK).
        "./ui/server-helper.ts": `import { readFileSync } from "node:fs";

export function helper(): string {
  return readFileSync("/dev/null", "utf-8");
}
`,
      }
    );
    assert.deepEqual(result.errors, [], `got ${JSON.stringify(result.errors)}`);
  });

  it("passes a component module whose type-only imports come from the allowlist (lit + engine types)", async () => {
    const result = await runDefinitionModuleGate(
      "module-set-component-clean",
      COMPONENT_DEFINITION,
      COMPONENT_MODULE,
      { "./ui/ticket-card.ts": IMPLEMENTED_COMPONENT }
    );
    assert.deepEqual(result.errors, [], `got ${JSON.stringify(result.errors)}`);
  });
});

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

  it("rejects an operation whose executor patches a sibling field its writesAcross does not declare (E1)", async () => {
    const CROSS_MODULE = `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "crossGateFlow",
  label: "Cross Gate Flow",
  configSchema: [],
  operations: [
    {
      id: "apply",
      ref: "./ops/apply.ts",
      writesAcross: [{ workflow: "ideas", fields: ["category"] }],
    },
  ],
  workflows: [
    {
      id: "organizer",
      label: "Organizer",
      instance: { title: "name" },
      instanceState: [{ field: "name", type: "string" }],
      initial: "working",
      terminalStates: ["working"],
      states: [
        {
          id: "working",
          label: "Working",
          category: "initial",
          tasks: [
            {
              id: "run",
              label: "Run",
              role: "operation",
              operations: ["apply"],
            },
          ],
        },
      ],
    },
    {
      id: "ideas",
      label: "Ideas",
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
    const SIBLING_OP = `import { defineOperations, type OperationContext } from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";

type OrganizerState = { name: string };

// Patches a sibling idea's state — category is declared in writesAcross, but
// bogusField is not: the declared-writes pass must reject the undeclared write.
export const applyOperations = defineOperations<OrganizerState>({
  apply: (
    _task: TaskDefinition,
    _params: Record<string, unknown>,
    ctx: OperationContext<OrganizerState>
  ) => {
    const idea = ctx.workflowInstancesInState("ideas")[0];
    if (!idea) return { ok: false };
    ctx.patchInstanceState(idea.id, { category: "launch", bogusField: "x" });
    return { ok: true };
  },
});
`;
    const { definition, findings } = parseDefinition(CROSS_MODULE);
    assert.deepEqual(findings, [], "cross module must parse clean");
    const result = await runDefinitionModuleGate(
      "module-set-sibling-writes",
      definition,
      CROSS_MODULE,
      { "./ops/apply.ts": SIBLING_OP }
    );
    assert.ok(
      result.errors.some(
        (e) =>
          e.includes("bogusField") &&
          e.includes("not declared in the operation's writesAcross")
      ),
      `expected a writesAcross finding, got ${JSON.stringify(result.errors)}`
    );
  });

  it("rejects an operation whose executor patches a flowState field the definition does not declare (E2)", async () => {
    const FLOWSTATE_MODULE = `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "flowStateGateFlow",
  label: "FlowState Gate Flow",
  configSchema: [],
  flowState: [{ field: "taxonomy", type: "object" }],
  operations: [{ id: "publish", ref: "./ops/publish.ts" }],
  workflows: [
    {
      id: "organize",
      label: "Organize",
      instance: { title: "name" },
      instanceState: [{ field: "name", type: "string" }],
      initial: "working",
      terminalStates: ["working"],
      states: [
        {
          id: "working",
          label: "Working",
          category: "initial",
          tasks: [
            {
              id: "run",
              label: "Run",
              role: "operation",
              operations: ["publish"],
            },
          ],
        },
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
    const PUBLISH_OP = `import { defineOperations, type OperationContext } from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";

type OrganizeState = { name: string };

export const publishOperations = defineOperations<OrganizeState>({
  publish: (
    _task: TaskDefinition,
    _params: Record<string, unknown>,
    ctx: OperationContext<OrganizeState>
  ) => {
    // taxonomy is declared in flowState, but mysteryField is not: the
    // declared-writes pass must reject the undeclared flowState write.
    ctx.patchFlowState({ taxonomy: { categories: ["infra"] }, mysteryField: 1 });
    return { ok: true };
  },
});
`;
    const { definition, findings } = parseDefinition(FLOWSTATE_MODULE);
    assert.deepEqual(findings, [], "flowState module must parse clean");
    const result = await runDefinitionModuleGate(
      "module-set-flowstate-writes",
      definition,
      FLOWSTATE_MODULE,
      { "./ops/publish.ts": PUBLISH_OP }
    );
    assert.ok(
      result.errors.some(
        (e) =>
          e.includes("mysteryField") &&
          e.includes("not declared in the definition's flowState")
      ),
      `expected a flowState-writes finding, got ${JSON.stringify(result.errors)}`
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

  it("the gate rejects an explicit `any` in a referenced file (the typecheck escape hatch)", async () => {
    const OP_WITH_ANY = `import { defineOperations } from "workflow-engine/runners";

export const scoreOperations = defineOperations<Record<string, unknown>>({
  score: async (task: any) => {
    const s = task.workflowInstanceState();
    return { score: s ? 7 : 0 };
  },
});
`;
    const result = await runDefinitionModuleGate(
      "module-set-any",
      FIVE_KIND,
      FIVE_KIND_MODULE,
      { ...IMPLEMENTED_FILES, "./ops/score.ts": OP_WITH_ANY }
    );
    assert.ok(
      result.errors.some(
        (e) =>
          e.startsWith("any ") && e.includes('explicit "any" is not allowed')
      ),
      `expected an explicit-any finding, got ${JSON.stringify(result.errors)}`
    );
  });

  it("the built-in presets pass the full gate (lint, imports, typecheck, writes, load)", async () => {
    for (const presetName of ["queen-bee", "wayfinder", "honeycomb"]) {
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
