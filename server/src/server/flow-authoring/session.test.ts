// The flow-authoring session: a single interactive drafting state whose ai-chat
// agent maintains the definition module via set_flow_definition and runs the
// full gate via the validate_definition TOOL — so gate failures return to the
// agent in the same conversation (nothing is lost) and the session never ends
// on its own. The engine's model caller is stubbed (the runner seam); the
// tools and the gate run for real, proving the lifecycle without a provider
// call.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createFlowRuntime } from "workflow-engine/create-flow-runtime";
import {
  createAiChatRunner,
  createOperationRunner,
  type OperationContext,
  toToolMaps,
} from "workflow-engine/runners";
import type { ToolCall } from "workflow-engine/runners/tool-types";
import type { TaskRunnerContext } from "workflow-engine/task-runner";
import {
  analyzeFlowDefinition,
  parseDefinition,
  validateFlowDefinition,
} from "../flow-definition.ts";
import {
  getRegisteredFlowDefinition,
  loadUserDefinitionsFromDisk,
  resetFlowDefinitionsForTest,
  runtimeDefinitionsDir,
  setDefinitionsBasePathForTest,
} from "../flow-definitions.ts";
import { FLOW_SCAFFOLD_SOURCE } from "./scaffold.ts";
import {
  type AuthoringItemState,
  authoringSessionFlow,
  authoringTools,
} from "./session.ts";

// A definition module with one referenced tool, used to drive the file-editing
// loop in-conversation.
const FILE_LOOP_MODULE = `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "fileLoopFlow",
  label: "File Loop Flow",
  configSchema: [],
  dependencies: [],
  tools: [{ id: "websearch", ref: "./tools/search.ts" }],
  workflows: [
    {
      id: "items",
      label: "Items",
      instance: { title: "title" },
      instanceState: [{ field: "title", type: "string" }],
      initial: "inbox",
      terminalStates: ["done"],
      states: [
        {
          id: "inbox",
          label: "Inbox",
          category: "initial",
          tasks: [
            {
              id: "search",
              label: "Search",
              role: "ai-chat",
              systemPrompt: "Search, then complete.",
              tools: ["websearch"],
              completionTool: "complete_task",
              startOnUserInput: true,
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
  edges: [],
  actions: [
    {
      id: "add_item",
      label: "Add item",
      variant: "primary",
      createInstance: {
        workflowId: "items",
        fields: [{ key: "title", label: "Title", type: "string", required: true }],
      },
    },
  ],
};
`;

// A definition module with a referenced tool, a referenced gate, and an
// extractor — the module-set path end to end.
const REFS_MODULE = `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "refSessionFlow",
  label: "Ref Session Flow",
  configSchema: [],
  tools: [{ id: "websearch", ref: "./tools/websearch.ts" }],
  workflows: [
    {
      id: "items",
      label: "Items",
      instance: { title: "title" },
      instanceState: [
        { field: "title", type: "string" },
        { field: "verdict", type: "string" },
      ],
      initial: "inbox",
      terminalStates: ["done"],
      states: [
        {
          id: "inbox",
          label: "Inbox",
          category: "initial",
          tasks: [
            {
              id: "classify",
              label: "Classify",
              role: "ai-chat",
              systemPrompt: "Classify, then call the completion tool.",
              tools: ["websearch"],
              completionTool: "complete_task",
              startOnUserInput: true,
            },
            {
              id: "extractVerdict",
              label: "Extract verdict",
              role: "operation",
              extract: { ref: "./extractors/parse.ts", fields: ["verdict"] },
            },
          ],
          autoTransitions: [
            { to: "done", gate: { kind: "file", ref: "./gates/approved.ts" } },
            { to: "inbox", gate: { kind: "always" } },
          ],
        },
        { id: "done", label: "Done", category: "terminal" },
      ],
    },
  ],
  edges: [],
  actions: [
    {
      id: "add_item",
      label: "Add item",
      variant: "primary",
      createInstance: {
        workflowId: "items",
        fields: [{ key: "title", label: "Title", type: "string", required: true }],
      },
    },
  ],
};
`;

// The implemented tool (the "implement the stub" step) — exports the exact
// name the definition's tool ref expects.
const LOOP_TOOL_IMPLEMENTATION = `import { defineTool } from "workflow-engine/runners";

export const websearchTools = [
  defineTool({
    name: "websearch",
    description: "Search the web.",
    parameters: {
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    executor: async (call) => {
      return { toolCallId: call.id, content: "found it", isError: false };
    },
  }),
];
`;

// A tool file importing a package the definition does not declare.
const TOOL_IMPORTING_LRU = `import { LRUCache } from "lru-cache";
import { defineTool } from "workflow-engine/runners";

export const websearchTools = [
  defineTool({
    name: "websearch",
    description: "Search.",
    parameters: { properties: {}, required: [] },
    executor: async (call) => {
      return { toolCallId: call.id, content: "found it", isError: false };
    },
  }),
];
`;

// A gate-clean data definition module the save_definition tool registers.
const SAVE_MODULE = `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "reviewFlow",
  label: "Review Flow",
  configSchema: [],
  workflows: [
    {
      id: "review",
      label: "Review",
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

// The module-set slug the conversation tests' session records (each test's
// session works in its own directory — the shared fallback is not used).
const AUTHOR_TEST_SLUG = "author-test-session";

const toolMaps = toToolMaps(authoringTools);

function operationContext(
  ctx: TaskRunnerContext
): OperationContext<AuthoringItemState> {
  return {
    flowConfig: () => ctx.flowConfig,
    instanceId: ctx.instanceId,
    workflowId: ctx.workflowId,
    currentState: ctx.currentState,
    workflowInstanceState: () =>
      ctx.workflowInstanceState as AuthoringItemState,
    taskOutputs: () => ctx.taskOutputs,
    patchWorkflowInstanceState: (patch) =>
      ctx.patchWorkflowInstanceState(patch as Record<string, unknown>),
    flowState: () => ctx.flowState(),
    patchFlowState: ctx.patchFlowState,
    workflowInstancesInState: ctx.workflowInstancesInState,
    patchInstanceState: (instanceId, patch) =>
      ctx.patchSiblingInstanceState(instanceId, patch),
  };
}

// A stateful model stub: each call returns the next scripted tool call or a
// plain text reply, so a test can drive the conversation end to end.
function scriptedModel(script: Array<ToolCall | string>) {
  let i = 0;
  return async (): Promise<{ content: string; toolCalls?: ToolCall[] }> => {
    const entry = script[i];
    i++;
    assert.ok(entry !== undefined, `model stub exhausted after ${i} calls`);
    if (typeof entry === "string") return { content: entry };
    return { content: "", toolCalls: [entry] };
  };
}

function buildRuntime(model: ReturnType<typeof scriptedModel>) {
  return createFlowRuntime(
    "author-test",
    authoringSessionFlow.workflows,
    [],
    {
      "ai-chat": (ctx) =>
        createAiChatRunner({
          modelCaller: model,
          toolDefinitions: toolMaps.definitions,
          toolExecutors: toolMaps.executors,
          basePath: join(tmpdir(), "hive-authoring"),
          workflowInstanceState: ctx.workflowInstanceState,
          patchRunningTaskMessages: ctx.patchRunningTaskMessages,
          patchWorkflowInstanceState: ctx.patchWorkflowInstanceState,
          createWorkflowInstance: ctx.createWorkflowInstance,
        }),
      operation: (ctx) =>
        createOperationRunner({
          getContext: () => operationContext(ctx),
          operations: {},
        }),
    },
    { definitionId: "flow-authoring", name: "author-test" }
  );
}

function setDefinitionCall(source: string): ToolCall {
  return {
    id: "c1",
    name: "set_flow_definition",
    arguments: JSON.stringify({ source }),
  };
}

function validateCall(): ToolCall {
  return {
    id: "c2",
    name: "validate_definition",
    arguments: "{}",
  };
}

// The referenced-module implementations the REFS_MODULE entry declares (the
// same sources the direct-executor tests pass in instance state). A real
// authoring conversation implements the refs with write_definition_file
// before validating — the gate materializes exactly the declared set.
const APPROVED_GATE_IMPLEMENTATION = `import type { GateContract } from "workflow-engine/workflow-types";
export const approved: GateContract = () => true;
`;

const PARSE_EXTRACTOR_IMPLEMENTATION = `import type { OutputExtractor } from "workflow-engine/workflow-types";
export const parse: OutputExtractor = () => ({ verdict: "x" });
`;

function writeFileCall(path: string, content: string): ToolCall {
  return {
    id: `w-${path}`,
    name: "write_definition_file",
    arguments: JSON.stringify({ path, content }),
  };
}

// The write calls that implement every file REFS_MODULE references.
function refFileWrites(): ToolCall[] {
  return [
    writeFileCall("./tools/websearch.ts", LOOP_TOOL_IMPLEMENTATION),
    writeFileCall("./gates/approved.ts", APPROVED_GATE_IMPLEMENTATION),
    writeFileCall("./extractors/parse.ts", PARSE_EXTRACTOR_IMPLEMENTATION),
  ];
}

// A definition module that fails validation (a transition to an unknown
// state).
const BAD_MODULE = REFS_MODULE.replace(
  '{ to: "done", gate: { kind: "file", ref: "./gates/approved.ts" } },',
  '{ to: "missing", gate: { kind: "file", ref: "./gates/approved.ts" } },'
);

async function runConversation(script: Array<ToolCall | string>) {
  const model = scriptedModel(script);
  const runtime = buildRuntime(model);
  const controller = runtime.addWorkflowInstance("session");
  controller.patchWorkflowInstanceState({ moduleSetSlug: AUTHOR_TEST_SLUG });
  // The session's chat task starts asynchronously; wait until it is running.
  for (let poll = 0; poll < 200; poll++) {
    if (controller.getState().hasRunningTask) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(controller.getState().currentState, "drafting");
  assert.equal(controller.getState().hasRunningTask, true);
  controller.sendTaskInput("assistant", "Build a triage flow", "user");
  // Wait for the conversation to go quiescent instead of sleeping a fixed
  // budget: each scripted entry is one model turn whose tool chain completes
  // before the next turn, so once the transcript stops growing for several
  // consecutive polls the engine chains have drained. A fixed sleep flakes
  // under load (e.g. inside a pre-commit hook running on a busy machine).
  let previousHistoryLength = -1;
  let stablePolls = 0;
  for (let poll = 0; poll < 400 && stablePolls < 6; poll++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    const historyLength = controller.getState().history.length;
    if (historyLength === previousHistoryLength) {
      stablePolls++;
    } else {
      stablePolls = 0;
      previousHistoryLength = historyLength;
    }
  }
  assert.ok(
    stablePolls >= 6,
    "the conversation must drain within the quiescence budget"
  );
  return controller;
}

describe("flow-authoring session", () => {
  it("converges on a definition module and validates gate-clean source in the same conversation", async () => {
    const controller = await runConversation([
      setDefinitionCall(REFS_MODULE),
      // A real conversation implements the declared refs before validating —
      // the gate materializes exactly the declared set and fails on a missing
      // referenced file.
      ...refFileWrites(),
      validateCall(),
      "Done!",
    ]);

    const state = controller.getState();
    assert.equal(
      state.currentState,
      "drafting",
      "the session must never leave drafting"
    );
    assert.equal(
      state.history.filter((h) => h.type === "state_transition").length,
      0,
      "validation must not transition the instance"
    );
    const itemState = state.workflowInstanceState as AuthoringItemState;
    assert.ok(
      typeof itemState.source === "string" &&
        itemState.source.includes("FlowDefinition"),
      "the validated source must be written into instance state"
    );
    assert.equal(itemState.report?.passed, true);
    assert.equal(
      itemState.suggestedName,
      "Ref Session Flow",
      "the definition's label must be suggested as the definition name"
    );
    assert.deepEqual(itemState.gateErrors ?? [], []);
  });

  it("returns gate failures to the agent in-conversation, which fixes and revalidates", async () => {
    const controller = await runConversation([
      setDefinitionCall(BAD_MODULE),
      ...refFileWrites(),
      validateCall(),
      setDefinitionCall(REFS_MODULE),
      validateCall(),
      "Done!",
    ]);

    const state = controller.getState();
    assert.equal(
      state.currentState,
      "drafting",
      "a failed gate must not transition the instance — the conversation continues"
    );
    assert.equal(
      state.history.filter((h) => h.type === "state_transition").length,
      0,
      "the whole fix-and-retry cycle must stay in one session"
    );
    const itemState = state.workflowInstanceState as AuthoringItemState;
    assert.equal(itemState.report?.passed, true);
    assert.ok(
      typeof itemState.source === "string" && itemState.source !== "",
      "the corrected module must produce a source"
    );
    assert.deepEqual(itemState.gateErrors ?? [], []);
  });

  it("set_flow_definition reports validation findings and stores the module", async () => {
    const tool = authoringTools.find(
      (t) => t.definition.function.name === "set_flow_definition"
    );
    assert.ok(tool, "set_flow_definition tool must be defined");

    const captured: { patched?: Partial<AuthoringItemState> } = {};
    const result = await tool.executor(
      {
        id: "x1",
        name: "set_flow_definition",
        arguments: JSON.stringify({ source: BAD_MODULE }),
      },
      {
        patchWorkflowInstanceState: (patch: Partial<AuthoringItemState>) => {
          captured.patched = patch;
        },
      } as never
    );
    assert.equal(result.isError, false);
    assert.match(result.content, /finding/);
    assert.ok(
      (captured.patched?.previewErrors?.length ?? 0) > 0,
      "validation findings must land in previewErrors"
    );
    assert.equal(captured.patched?.source, BAD_MODULE);
    // The parsed definition rides along for the editor's Definition tab.
    assert.ok(captured.patched?.parsedDefinition !== undefined);
  });

  it("validate_definition writes the source on success and gateErrors on failure", async () => {
    const tool = authoringTools.find(
      (t) => t.definition.function.name === "validate_definition"
    );
    assert.ok(tool, "validate_definition tool must be defined");

    // Success: the module passes the full gate.
    const okCaptured: { patched?: Partial<AuthoringItemState> } = {};
    const ok = await tool.executor(
      { id: "g1", name: "validate_definition", arguments: "{}" },
      {
        workflowInstanceState: () => ({
          source: REFS_MODULE,
          files: {
            "./tools/websearch.ts": LOOP_TOOL_IMPLEMENTATION,
            "./gates/approved.ts":
              'import type { GateContract } from "workflow-engine/workflow-types";\nexport const approved: GateContract = () => true;\n',
            "./extractors/parse.ts":
              'import type { OutputExtractor } from "workflow-engine/workflow-types";\nexport const parse: OutputExtractor = () => ({ verdict: "x" });\n',
          },
        }),
        patchWorkflowInstanceState: (patch: Partial<AuthoringItemState>) => {
          okCaptured.patched = patch;
        },
      } as never
    );
    assert.equal(ok.isError, false);
    assert.match(ok.content, /validated and compiled successfully/);
    assert.ok(
      typeof okCaptured.patched?.source === "string" &&
        okCaptured.patched.source.includes("FlowDefinition")
    );
    assert.equal(okCaptured.patched?.report?.passed, true);
    assert.deepEqual(okCaptured.patched?.gateErrors ?? [], []);

    // Failure: a module that fails validation records the findings.
    const badCaptured: { patched?: Partial<AuthoringItemState> } = {};
    const bad = await tool.executor(
      { id: "g2", name: "validate_definition", arguments: "{}" },
      {
        workflowInstanceState: () => ({ source: BAD_MODULE }),
        patchWorkflowInstanceState: (patch: Partial<AuthoringItemState>) => {
          badCaptured.patched = patch;
        },
      } as never
    );
    assert.equal(bad.isError, false);
    assert.match(bad.content, /failed/);
    assert.equal(badCaptured.patched?.report?.passed, false);
    assert.ok(
      (badCaptured.patched?.gateErrors?.length ?? 0) > 0,
      "gate failures must record gateErrors"
    );
  });

  it("read_authoring_knowledge serves the reference modules on demand", async () => {
    const tool = authoringTools.find(
      (t) => t.definition.function.name === "read_authoring_knowledge"
    );
    assert.ok(tool, "read_authoring_knowledge tool must be defined");

    for (const topic of ["vocabulary", "capabilities", "rules"]) {
      const result = await tool.executor(
        {
          id: `k-${topic}`,
          name: "read_authoring_knowledge",
          arguments: JSON.stringify({ topic }),
        },
        {} as never
      );
      assert.equal(result.isError, false, topic);
      assert.ok(
        result.content.length > 200,
        `${topic} module must be substantive`
      );
    }

    const unknown = await tool.executor(
      {
        id: "k-x",
        name: "read_authoring_knowledge",
        arguments: JSON.stringify({ topic: "nonsense" }),
      },
      {} as never
    );
    assert.equal(unknown.isError, true);
    assert.match(unknown.content, /Unknown topic/);
  });

  it("the canonical scaffold is a valid definition module with zero errors and zero warnings", () => {
    // The scaffold is what the new-flow editor shows and every session seeds
    // from — it must stay valid as the vocabulary evolves (the new-flow
    // screen is unbreakable).
    const { definition, findings } = parseDefinition(FLOW_SCAFFOLD_SOURCE);
    assert.deepEqual(findings, []);
    assert.deepEqual(
      validateFlowDefinition(definition),
      [],
      "the scaffold must have zero validation errors"
    );
    assert.deepEqual(
      analyzeFlowDefinition(definition),
      [],
      "the scaffold must analyze clean (zero warnings)"
    );
    assert.equal(definition.id, "myFlow");
    assert.equal(definition.workflows.length, 1);
  });

  it("save_definition registers the generated definition and records the save in instance state", async () => {
    const defsDir = mkdtempSync(join(tmpdir(), "hive-author-save-"));
    setDefinitionsBasePathForTest(defsDir);
    resetFlowDefinitionsForTest();
    try {
      const tool = authoringTools.find(
        (t) => t.definition.function.name === "save_definition"
      );
      assert.ok(tool, "save_definition tool must be defined");

      let state: AuthoringItemState = {
        source: SAVE_MODULE,
        suggestedName: "Review Flow",
      };
      const result = await tool.executor(
        { id: "s1", name: "save_definition", arguments: "{}" },
        {
          workflowInstanceState: () => state,
          patchWorkflowInstanceState: (patch: Partial<AuthoringItemState>) => {
            state = { ...state, ...patch };
          },
        } as never
      );
      assert.equal(result.isError, false);
      assert.match(result.content, /review-flow/);
      assert.equal(state.savedDefinitionId, "review-flow");
      assert.ok(Array.isArray(state.saveFindings?.warnings));

      // A second call updates the same definition (no duplicate).
      const again = await tool.executor(
        { id: "s2", name: "save_definition", arguments: "{}" },
        {
          workflowInstanceState: () => state,
          patchWorkflowInstanceState: (patch: Partial<AuthoringItemState>) => {
            state = { ...state, ...patch };
          },
        } as never
      );
      assert.equal(again.isError, false);
      assert.equal(state.savedDefinitionId, "review-flow");
    } finally {
      rmSync(defsDir, { recursive: true, force: true });
      resetFlowDefinitionsForTest();
    }
  });

  it("save_definition rejects a session with no source", async () => {
    const tool = authoringTools.find(
      (t) => t.definition.function.name === "save_definition"
    );
    assert.ok(tool, "save_definition tool must be defined");
    const result = await tool.executor(
      { id: "s3", name: "save_definition", arguments: "{}" },
      {
        workflowInstanceState: () => ({}),
      } as never
    );
    assert.equal(result.isError, true);
    assert.match(result.content, /Nothing to save/);
  });

  it("read_definition_source returns the current source, including manual edits", async () => {
    const tool = authoringTools.find(
      (t) => t.definition.function.name === "read_definition_source"
    );
    assert.ok(tool, "read_definition_source tool must be defined");

    const withManual = await tool.executor(
      { id: "r1", name: "read_definition_source", arguments: "{}" },
      {
        workflowInstanceState: () => ({
          source: "export const flow = {}; // hand edit",
        }),
      } as never
    );
    assert.equal(withManual.isError, false);
    assert.match(withManual.content, /hand edit/);

    const none = await tool.executor(
      { id: "r2", name: "read_definition_source", arguments: "{}" },
      {
        workflowInstanceState: () => ({}),
      } as never
    );
    assert.equal(none.isError, false);
    assert.match(none.content, /No definition module yet/);
  });

  it("a definition module with file references validates and saves a module set (file set on the record)", async () => {
    const defsDir = mkdtempSync(join(tmpdir(), "hive-author-refs-"));
    setDefinitionsBasePathForTest(defsDir);
    resetFlowDefinitionsForTest();
    try {
      const controller = await runConversation([
        setDefinitionCall(REFS_MODULE),
        validateCall(),
        {
          id: "w-gate",
          name: "write_definition_file",
          arguments: JSON.stringify({
            path: "./gates/approved.ts",
            content:
              'import type { GateContract } from "workflow-engine/workflow-types";\nexport const approved: GateContract = () => true;\n',
          }),
        },
        {
          id: "w-tool",
          name: "write_definition_file",
          arguments: JSON.stringify({
            path: "./tools/websearch.ts",
            content: LOOP_TOOL_IMPLEMENTATION,
          }),
        },
        {
          id: "w-extract",
          name: "write_definition_file",
          arguments: JSON.stringify({
            path: "./extractors/parse.ts",
            content:
              'import type { OutputExtractor } from "workflow-engine/workflow-types";\nexport const parse: OutputExtractor = () => ({ verdict: "x" });\n',
          }),
        },
        validateCall(),
        { id: "s-ref", name: "save_definition", arguments: "{}" },
        "Done!",
      ]);
      const state = controller.getState()
        .workflowInstanceState as AuthoringItemState;
      assert.equal(state.report?.passed, true);
      assert.ok(
        typeof state.source === "string" &&
          state.source.includes("FlowDefinition"),
        "the stored source is the definition module"
      );
      assert.ok(
        state.files?.["./tools/websearch.ts"]?.includes("defineTool"),
        "the module-set files must be stored on the session"
      );
      assert.equal(state.savedDefinitionId, "ref-session-flow");

      const record = getRegisteredFlowDefinition("ref-session-flow");
      assert.ok(record, "the definition must register");
      assert.ok(
        record.files?.["./gates/approved.ts"]?.includes("GateContract"),
        "the record stores the referenced file set"
      );

      // The record re-materializes from disk on boot.
      resetFlowDefinitionsForTest();
      await loadUserDefinitionsFromDisk();
      const reloaded = getRegisteredFlowDefinition("ref-session-flow");
      assert.ok(reloaded, "the module-set definition must reload");
      assert.ok(
        reloaded.files?.["./extractors/parse.ts"]?.includes("OutputExtractor"),
        "the reloaded record keeps the file set"
      );
    } finally {
      rmSync(defsDir, { recursive: true, force: true });
      resetFlowDefinitionsForTest();
    }
  });

  it("read_definition_file and write_definition_file operate on the module-set files within the definition root", async () => {
    const probe = join(runtimeDefinitionsDir(), "author-test-files", "scratch");
    rmSync(probe, { recursive: true, force: true });
    try {
      const readTool = authoringTools.find(
        (t) => t.definition.function.name === "read_definition_file"
      );
      const writeTool = authoringTools.find(
        (t) => t.definition.function.name === "write_definition_file"
      );
      assert.ok(readTool && writeTool, "both file tools must exist");

      let state: AuthoringItemState = {
        moduleSetSlug: "author-test-files",
      };
      const ctx = {
        workflowInstanceState: () => state,
        patchWorkflowInstanceState: (patch: Partial<AuthoringItemState>) => {
          state = { ...state, ...patch };
        },
      } as never;

      const written = await writeTool.executor(
        {
          id: "w1",
          name: "write_definition_file",
          arguments: JSON.stringify({
            path: "./scratch/probe.ts",
            content: "export const probe = 1;\n",
          }),
        },
        ctx
      );
      assert.equal(written.isError, false);
      assert.equal(
        state.files?.["./scratch/probe.ts"],
        "export const probe = 1;\n",
        "the write must be recorded on the session's file set"
      );

      const read = await readTool.executor(
        {
          id: "r1",
          name: "read_definition_file",
          arguments: JSON.stringify({ path: "./scratch/probe.ts" }),
        },
        ctx
      );
      assert.equal(read.isError, false);
      assert.match(read.content, /export const probe/);

      const escapeWrite = await writeTool.executor(
        {
          id: "w2",
          name: "write_definition_file",
          arguments: JSON.stringify({ path: "../escape.ts", content: "x" }),
        },
        ctx
      );
      assert.equal(escapeWrite.isError, true);
      assert.match(escapeWrite.content, /definition root/);

      const entry = await writeTool.executor(
        {
          id: "w3",
          name: "write_definition_file",
          arguments: JSON.stringify({ path: "flow.ts", content: "x" }),
        },
        ctx
      );
      assert.equal(entry.isError, true);
      assert.match(entry.content, /definition module/);
    } finally {
      rmSync(probe, { recursive: true, force: true });
    }
  });

  it("the session agent creates and edits a referenced file in-conversation and the gate reflects it", async () => {
    const probe = join(
      runtimeDefinitionsDir(),
      AUTHOR_TEST_SLUG,
      "tools",
      "search.ts"
    );
    rmSync(probe, { recursive: true, force: true });
    try {
      const controller = await runConversation([
        setDefinitionCall(FILE_LOOP_MODULE),
        validateCall(),
        {
          id: "w1",
          name: "write_definition_file",
          arguments: JSON.stringify({
            path: "./tools/search.ts",
            content: LOOP_TOOL_IMPLEMENTATION,
          }),
        },
        {
          id: "r1",
          name: "read_definition_file",
          arguments: JSON.stringify({ path: "./tools/search.ts" }),
        },
        validateCall(),
        "Done!",
      ]);
      const state = controller.getState()
        .workflowInstanceState as AuthoringItemState;
      assert.equal(state.report?.passed, true);
      assert.equal(
        state.files?.["./tools/search.ts"],
        LOOP_TOOL_IMPLEMENTATION,
        "the implemented file must survive the second validate (hand edits are authoritative)"
      );
    } finally {
      rmSync(probe, { recursive: true, force: true });
    }
  });

  it("an undeclared import fails the gate with a dependency finding; declaring it passes", async () => {
    const probe = join(
      runtimeDefinitionsDir(),
      "author-test-undeclared",
      "tools",
      "search.ts"
    );
    rmSync(probe, { recursive: true, force: true });
    try {
      let state: AuthoringItemState = {
        moduleSetSlug: "author-test-undeclared",
        source: FILE_LOOP_MODULE,
      };
      const ctx = {
        workflowInstanceState: () => state,
        patchWorkflowInstanceState: (patch: Partial<AuthoringItemState>) => {
          state = { ...state, ...patch };
        },
      } as never;
      const validate = authoringTools.find(
        (t) => t.definition.function.name === "validate_definition"
      );
      const write = authoringTools.find(
        (t) => t.definition.function.name === "write_definition_file"
      );
      const setDefinition = authoringTools.find(
        (t) => t.definition.function.name === "set_flow_definition"
      );
      assert.ok(validate && write && setDefinition);

      // The agent writes a tool importing an undeclared package.
      await write.executor(
        {
          id: "w1",
          name: "write_definition_file",
          arguments: JSON.stringify({
            path: "./tools/search.ts",
            content: TOOL_IMPORTING_LRU,
          }),
        },
        ctx
      );
      await validate.executor(validateCall(), ctx);
      assert.equal(state.report?.passed, false);
      assert.ok(
        state.gateErrors?.some(
          (e) => /lru-cache/.test(e) && /dependencies/.test(e)
        ),
        `expected a dependency finding, got ${JSON.stringify(state.gateErrors)}`
      );

      // Declaring the package makes the same import pass.
      const fixed = FILE_LOOP_MODULE.replace(
        "dependencies: [],",
        'dependencies: ["lru-cache"],'
      );
      await setDefinition.executor(setDefinitionCall(fixed), ctx);
      await validate.executor(validateCall(), ctx);
      assert.equal(state.report?.passed, true);
    } finally {
      rmSync(probe, { recursive: true, force: true });
    }
  });
});
