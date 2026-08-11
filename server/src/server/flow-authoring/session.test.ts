// The flow-authoring session: a single interactive drafting state whose ai-chat
// agent maintains the spec via set_flow_spec and runs the generation gate via
// the generate_definition TOOL — so gate failures return to the agent in the
// same conversation (nothing is lost) and the session never ends on its own.
// The engine's model caller is stubbed (the runner seam); the tools and the
// gate run for real, proving the lifecycle without a provider call.

import assert from "node:assert/strict";
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
import { validateFlowSpec } from "../flow-spec.ts";
import {
  type AuthoringItemState,
  authoringSessionFlow,
  authoringTools,
} from "./session.ts";
import { STARTER_SKELETON } from "./session-prompt.ts";

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

function setSpecCall(spec: unknown): ToolCall {
  return {
    id: "c1",
    name: "set_flow_spec",
    arguments: JSON.stringify({ spec: JSON.stringify(spec) }),
  };
}

function genCall(spec: unknown): ToolCall {
  return {
    id: "c2",
    name: "generate_definition",
    arguments: JSON.stringify({ spec: JSON.stringify(spec) }),
  };
}

// A spec that fails validation (a gate referencing an unknown task).
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
  it("converges on a spec and generates gate-clean source in the same conversation", async () => {
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
      "the spec's label must be suggested as the definition name"
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
      "the corrected spec must produce a source"
    );
    assert.deepEqual(itemState.gateErrors ?? [], []);
  });

  it("set_flow_spec rejects invalid JSON and reports validation findings", async () => {
    const tool = authoringTools.find(
      (t) => t.definition.function.name === "set_flow_spec"
    );
    assert.ok(tool, "set_flow_spec tool must be defined");

    const badJson = await tool.executor(
      {
        id: "x1",
        name: "set_flow_spec",
        arguments: JSON.stringify({ spec: "{not json" }),
      },
      {} as never
    );
    assert.equal(badJson.isError, true);
    assert.match(badJson.content, /not valid JSON/);

    const captured: { patched?: Partial<AuthoringItemState> } = {};
    const findings = await tool.executor(
      {
        id: "x2",
        name: "set_flow_spec",
        arguments: JSON.stringify({
          spec: JSON.stringify({ id: "bad-id!", workflows: [] }),
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
          spec: JSON.stringify(STRUCTURED_INTAKE_EXEMPLAR),
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

    // Failure: a spec that fails validation records the findings.
    const badCaptured: { patched?: Partial<AuthoringItemState> } = {};
    const bad = await tool.executor(
      {
        id: "g2",
        name: "generate_definition",
        arguments: JSON.stringify({ spec: JSON.stringify(BAD_SPEC) }),
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

  it("the starter skeleton is a valid spec the agent begins from", () => {
    assert.deepEqual(validateFlowSpec(JSON.parse(STARTER_SKELETON)), []);
  });
});
