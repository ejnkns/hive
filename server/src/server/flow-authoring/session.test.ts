// The flow-authoring session: a single interactive drafting state whose ai-chat
// agent maintains the blueprint via set_flow_blueprint and runs the generation gate via
// the generate_definition TOOL — so gate failures return to the agent in the
// same conversation (nothing is lost) and the session never ends on its own.
// The engine's model caller is stubbed (the runner seam); the tools and the
// gate run for real, proving the lifecycle without a provider call.

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
import { STRUCTURED_INTAKE_EXEMPLAR } from "../flow-authoring.ts";
import { validateFlowBlueprint } from "../flow-blueprint.ts";
import {
  getRegisteredFlowDefinition,
  loadUserDefinitionsFromDisk,
  resetFlowDefinitionsForTest,
  runtimeDefinitionsDir,
  setDefinitionsBasePathForTest,
} from "../flow-definitions.ts";
import {
  AUTHORING_MODULE_SET,
  type AuthoringItemState,
  authoringSessionFlow,
  authoringTools,
} from "./session.ts";
import { STARTER_SKELETON } from "./session-prompt.ts";

// A minimal blueprint with one referenced tool, used to drive the file-editing
// loop in-conversation.
const FILE_LOOP_BLUEPRINT = {
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
      initialState: "inbox",
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
};

// The implemented tool (the "implement the stub" step) — exports the exact
// name the entry imports.
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

// A tool file importing a package the blueprint does not declare.
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

// A gate-clean definition source the save_definition tool registers.
const saveToolSource = `import { defineWorkflow } from "workflow-engine/workflow-types";

const wf = defineWorkflow({
  id: "review",
  label: "Review",
  taskOutputs: {} as Record<string, never>,
  workflowInstanceState: {} as Record<string, unknown>,
  states: [
    { id: "new", label: "New", category: "initial" },
    { id: "done", label: "Done", category: "terminal" },
  ],
  initial: "new",
  terminalStates: ["done"],
});

export const flow = {
  id: "review-flow",
  label: "Review Flow",
  configSchema: [],
  workflows: [wf],
  edges: [],
};
`;

const toolMaps = toToolMaps(authoringTools);

function operationContext(
  ctx: TaskRunnerContext
): OperationContext<AuthoringItemState> {
  return {
    flowConfig: () => ctx.flowConfig,
    patchFlowConfig: ctx.patchFlowConfig,
    instanceId: ctx.instanceId,
    workflowId: ctx.workflowId,
    currentState: ctx.currentState,
    workflowInstanceState: () =>
      ctx.workflowInstanceState as AuthoringItemState,
    taskOutputs: () => ctx.taskOutputs,
    patchWorkflowInstanceState: (patch) =>
      ctx.patchWorkflowInstanceState(patch as Record<string, unknown>),
    workflowInstancesInState: ctx.workflowInstancesInState,
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

function setSpecCall(blueprint: unknown): ToolCall {
  return {
    id: "c1",
    name: "set_flow_blueprint",
    arguments: JSON.stringify({ blueprint: JSON.stringify(blueprint) }),
  };
}

function genCall(blueprint: unknown): ToolCall {
  return {
    id: "c2",
    name: "generate_definition",
    arguments: JSON.stringify({ blueprint: JSON.stringify(blueprint) }),
  };
}

// A blueprint that fails validation (a gate referencing an unknown task).
const BAD_SPEC = {
  ...STRUCTURED_INTAKE_EXEMPLAR,
  workflows: [
    {
      ...STRUCTURED_INTAKE_EXEMPLAR.workflows[0],
      states: STRUCTURED_INTAKE_EXEMPLAR.workflows[0].states.map((s) =>
        s.id === "inbox"
          ? {
              ...s,
              autoTransitions: [
                {
                  to: "needs_review",
                  gate: { kind: "taskSuccess", task: "nonexistent" },
                },
              ],
            }
          : s
      ),
    },
  ],
};

async function settle(): Promise<void> {
  // Let the engine's async chains (model turns, tool execution, the gate) run.
  await new Promise((resolve) => setTimeout(resolve, 50));
}

async function runConversation(script: Array<ToolCall | string>) {
  const model = scriptedModel(script);
  const runtime = buildRuntime(model);
  const controller = runtime.addWorkflowInstance("session");
  await settle();
  assert.equal(controller.getState().currentState, "drafting");
  assert.equal(controller.getState().hasRunningTask, true);
  controller.sendTaskInput("assistant", "Build a triage flow", "user");
  for (let i = 0; i < 8; i++) await settle();
  return controller;
}

describe("flow-authoring session", () => {
  it("converges on a blueprint and generates gate-clean source in the same conversation", async () => {
    const controller = await runConversation([
      setSpecCall(STRUCTURED_INTAKE_EXEMPLAR),
      genCall(STRUCTURED_INTAKE_EXEMPLAR),
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
      "generation must not transition the instance"
    );
    const itemState = state.workflowInstanceState as AuthoringItemState;
    assert.ok(
      typeof itemState.source === "string" &&
        itemState.source.includes("defineWorkflow"),
      "the gate-passed source must be written into instance state"
    );
    assert.equal(itemState.report?.passed, true);
    assert.equal(
      itemState.suggestedName,
      "Item Intake",
      "the blueprint's label must be suggested as the definition name"
    );
    assert.deepEqual(itemState.gateErrors ?? [], []);
  });

  it("returns gate failures to the agent in-conversation, which fixes and regenerates", async () => {
    const controller = await runConversation([
      setSpecCall(BAD_SPEC),
      genCall(BAD_SPEC),
      setSpecCall(STRUCTURED_INTAKE_EXEMPLAR),
      genCall(STRUCTURED_INTAKE_EXEMPLAR),
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
      "the corrected blueprint must produce a source"
    );
    assert.deepEqual(itemState.gateErrors ?? [], []);
  });

  it("set_flow_blueprint rejects invalid JSON and reports validation findings", async () => {
    const tool = authoringTools.find(
      (t) => t.definition.function.name === "set_flow_blueprint"
    );
    assert.ok(tool, "set_flow_blueprint tool must be defined");

    const badJson = await tool.executor(
      {
        id: "x1",
        name: "set_flow_blueprint",
        arguments: JSON.stringify({ blueprint: "{not json" }),
      },
      {} as never
    );
    assert.equal(badJson.isError, true);
    assert.match(badJson.content, /not valid JSON/);

    const captured: { patched?: Partial<AuthoringItemState> } = {};
    const findings = await tool.executor(
      {
        id: "x2",
        name: "set_flow_blueprint",
        arguments: JSON.stringify({
          blueprint: JSON.stringify({ id: "bad-id!", workflows: [] }),
        }),
      },
      {
        patchWorkflowInstanceState: (patch: Partial<AuthoringItemState>) => {
          captured.patched = patch;
        },
      } as never
    );
    assert.equal(findings.isError, false);
    assert.match(findings.content, /finding/);
    assert.ok(
      (captured.patched?.previewErrors?.length ?? 0) > 0,
      "validation findings must land in previewErrors"
    );
  });

  it("generate_definition writes the source on success and gateErrors on failure", async () => {
    const tool = authoringTools.find(
      (t) => t.definition.function.name === "generate_definition"
    );
    assert.ok(tool, "generate_definition tool must be defined");

    // Success: the exemplar passes the full gate.
    const okCaptured: { patched?: Partial<AuthoringItemState> } = {};
    const ok = await tool.executor(
      {
        id: "g1",
        name: "generate_definition",
        arguments: JSON.stringify({
          blueprint: JSON.stringify(STRUCTURED_INTAKE_EXEMPLAR),
        }),
      },
      {
        patchWorkflowInstanceState: (patch: Partial<AuthoringItemState>) => {
          okCaptured.patched = patch;
        },
      } as never
    );
    assert.equal(ok.isError, false);
    assert.match(ok.content, /generated successfully/);
    assert.ok(
      typeof okCaptured.patched?.source === "string" &&
        okCaptured.patched.source.includes("defineWorkflow")
    );
    assert.equal(okCaptured.patched?.report?.passed, true);
    assert.deepEqual(okCaptured.patched?.gateErrors ?? [], []);

    // Failure: a blueprint that fails validation records the findings.
    const badCaptured: { patched?: Partial<AuthoringItemState> } = {};
    const bad = await tool.executor(
      {
        id: "g2",
        name: "generate_definition",
        arguments: JSON.stringify({ blueprint: JSON.stringify(BAD_SPEC) }),
      },
      {
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
    assert.equal(badCaptured.patched?.source, undefined);
  });

  it("read_authoring_knowledge serves the reference modules on demand", async () => {
    const tool = authoringTools.find(
      (t) => t.definition.function.name === "read_authoring_knowledge"
    );
    assert.ok(tool, "read_authoring_knowledge tool must be defined");

    for (const topic of ["vocabulary", "patterns", "capabilities", "rules"]) {
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

  it("the starter skeleton is a valid blueprint the agent begins from", () => {
    assert.deepEqual(validateFlowBlueprint(JSON.parse(STARTER_SKELETON)), []);
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
        source: saveToolSource,
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

  it("save_definition rejects a session with no generated source", async () => {
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

  it("set_flow_blueprint and generate_definition refuse while the source is diverged", async () => {
    const divergedCtx = {
      workflowInstanceState: () => ({
        source: "export const flow = {}; // hand edit",
        blueprintDiverged: true,
      }),
      patchWorkflowInstanceState: () => {},
    } as never;
    for (const name of ["set_flow_blueprint", "generate_definition"]) {
      const tool = authoringTools.find(
        (t) => t.definition.function.name === name
      );
      assert.ok(tool, `${name} tool must be defined`);
      const result = await tool.executor(
        { id: `d-${name}`, name, arguments: "{}" },
        divergedCtx
      );
      assert.equal(result.isError, true, `${name} must refuse while diverged`);
      assert.match(result.content, /manual edits/, `${name} gate message`);
    }
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
          blueprintDiverged: true,
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
    assert.match(none.content, /No definition source yet/);
  });

  it("a blueprint with file references generates and saves a module set (blueprint + file set on the record)", async () => {
    const defsDir = mkdtempSync(join(tmpdir(), "hive-author-refs-"));
    setDefinitionsBasePathForTest(defsDir);
    resetFlowDefinitionsForTest();
    try {
      const blueprint = {
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
            initialState: "inbox",
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
                    extract: {
                      ref: "./extractors/parse.ts",
                      fields: ["verdict"],
                    },
                  },
                ],
                autoTransitions: [
                  {
                    to: "done",
                    gate: { kind: "file", ref: "./gates/approved.ts" },
                  },
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
      };
      const controller = await runConversation([
        setSpecCall(blueprint),
        genCall(blueprint),
        { id: "s-ref", name: "save_definition", arguments: "{}" },
        "Done!",
      ]);
      const state = controller.getState()
        .workflowInstanceState as AuthoringItemState;
      assert.equal(state.report?.passed, true);
      assert.ok(
        typeof state.source === "string" &&
          state.source.includes(
            'import { approved } from "./gates/approved.ts";'
          ),
        "the stored source is the module-set entry wiring the references"
      );
      assert.ok(
        state.files?.["./tools/websearch.ts"]?.includes("defineTool"),
        "the module-set files must be stored on the session"
      );
      assert.equal(state.savedDefinitionId, "ref-session-flow");

      const record = getRegisteredFlowDefinition("ref-session-flow");
      assert.ok(record, "the definition must register");
      assert.equal(record.blueprint?.id, "refSessionFlow");
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
    const workDir = join(runtimeDefinitionsDir(), AUTHORING_MODULE_SET);
    rmSync(workDir, { recursive: true, force: true });
    try {
      const readTool = authoringTools.find(
        (t) => t.definition.function.name === "read_definition_file"
      );
      const writeTool = authoringTools.find(
        (t) => t.definition.function.name === "write_definition_file"
      );
      assert.ok(readTool && writeTool, "both file tools must exist");

      let state: AuthoringItemState = {};
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
      assert.match(entry.content, /rendered entry/);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("the session agent creates and edits a referenced file in-conversation and the gate reflects it", async () => {
    const workDir = join(runtimeDefinitionsDir(), AUTHORING_MODULE_SET);
    rmSync(workDir, { recursive: true, force: true });
    try {
      const controller = await runConversation([
        setSpecCall(FILE_LOOP_BLUEPRINT),
        genCall(FILE_LOOP_BLUEPRINT),
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
        genCall(FILE_LOOP_BLUEPRINT),
        "Done!",
      ]);
      const state = controller.getState()
        .workflowInstanceState as AuthoringItemState;
      assert.equal(state.report?.passed, true);
      assert.equal(
        state.files?.["./tools/search.ts"],
        LOOP_TOOL_IMPLEMENTATION,
        "the implemented file must survive the second generate (hand edits are authoritative)"
      );
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("an undeclared import fails the gate with a dependency finding; declaring it passes", async () => {
    const workDir = join(runtimeDefinitionsDir(), AUTHORING_MODULE_SET);
    rmSync(workDir, { recursive: true, force: true });
    try {
      let state: AuthoringItemState = {
        blueprint: JSON.stringify(FILE_LOOP_BLUEPRINT),
      };
      const ctx = {
        workflowInstanceState: () => state,
        patchWorkflowInstanceState: (patch: Partial<AuthoringItemState>) => {
          state = { ...state, ...patch };
        },
      } as never;
      const generate = authoringTools.find(
        (t) => t.definition.function.name === "generate_definition"
      );
      const write = authoringTools.find(
        (t) => t.definition.function.name === "write_definition_file"
      );
      const setBlueprint = authoringTools.find(
        (t) => t.definition.function.name === "set_flow_blueprint"
      );
      assert.ok(generate && write && setBlueprint);

      // The clean stub passes the gate.
      await generate.executor(genCall(FILE_LOOP_BLUEPRINT), ctx);
      assert.equal(state.report?.passed, true);

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
      await generate.executor(genCall(FILE_LOOP_BLUEPRINT), ctx);
      assert.equal(state.report?.passed, false);
      assert.ok(
        state.gateErrors?.some(
          (e) => /lru-cache/.test(e) && /dependencies/.test(e)
        ),
        `expected a dependency finding, got ${JSON.stringify(state.gateErrors)}`
      );

      // Declaring the package makes the same import pass.
      const fixed = { ...FILE_LOOP_BLUEPRINT, dependencies: ["lru-cache"] };
      await setBlueprint.executor(setSpecCall(fixed), ctx);
      await generate.executor(genCall(fixed), ctx);
      assert.equal(state.report?.passed, true);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
