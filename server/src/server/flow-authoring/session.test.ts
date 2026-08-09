// The flow-authoring session: a hidden flow whose ai-chat agent converges on a
// spec, finalizes through the full generation gate, and bounces gate failures
// back to a bounded revising round. The engine's model caller is stubbed (the
// runner seam), while the tools, operations, and the gate run for real — so
// this proves the session lifecycle end to end without a provider call.

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
import { STRUCTURED_INTAKE_EXEMPLAR } from "./index";
import {
  type AuthoringItemState,
  authoringOperations,
  authoringSessionFlow,
  authoringTools,
} from "./session";

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

// A stateful model stub: each call returns the next scripted tool call, so a
// test can drive the drafting session and any revising rounds.
function scriptedModel(script: ToolCall[]) {
  let i = 0;
  return async (): Promise<{ content: string; toolCalls?: ToolCall[] }> => {
    const call = script[i];
    i++;
    assert.ok(call, `model stub exhausted after ${i} calls`);
    return { content: "", toolCalls: [call] };
  };
}

function buildRuntime(
  model: ReturnType<typeof scriptedModel>,
  mode: "conversational" | "lucky" = "conversational"
) {
  return createFlowRuntime(
    "author-test",
    authoringSessionFlow.buildWorkflows({ mode }),
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
          operations: authoringOperations,
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

const finishCall: ToolCall = {
  id: "c2",
  name: "finish_authoring",
  arguments: "{}",
};

async function settle(): Promise<void> {
  // Let the engine's auto task chains (model turns, tool execution, the gate)
  // run to completion.
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe("flow-authoring session", () => {
  it("converges on a spec, finalizes, and produces gate-clean source", async () => {
    const model = scriptedModel([
      setSpecCall(STRUCTURED_INTAKE_EXEMPLAR),
      finishCall,
    ]);
    const runtime = buildRuntime(model);
    const controller = runtime.addWorkflowInstance("session");
    await settle();
    // The drafting session is running and waiting for the first message.
    assert.equal(controller.getState().currentState, "drafting");
    assert.equal(controller.getState().hasRunningTask, true);

    controller.sendTaskInput("assistant", "Build a triage flow", "user");
    await settle();
    await settle();

    assert.equal(
      controller.getState().currentState,
      "done",
      `expected done, got ${controller.getState().currentState}`
    );
    const state = controller.getState()
      .workflowInstanceState as AuthoringItemState;
    assert.ok(
      typeof state.source === "string" &&
        state.source.includes("defineWorkflow"),
      "the gate-passed source must be written into instance state"
    );
    assert.equal(state.report?.passed, true);
    assert.equal(
      state.suggestedName,
      "Item Intake",
      "the spec's label must be suggested as the definition name"
    );
    assert.deepEqual(state.gateErrors ?? [], []);
  });

  it("bounces gate failures back to a revising round that fixes the spec", async () => {
    // Draft with a spec that fails validation (unknown task in a gate), then
    // finish; the gate rejects → revising → the agent submits the corrected
    // spec and finishes → done.
    const badSpec = {
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
    const model = scriptedModel([
      setSpecCall(badSpec),
      finishCall,
      setSpecCall(STRUCTURED_INTAKE_EXEMPLAR),
      finishCall,
    ]);
    const runtime = buildRuntime(model);
    const controller = runtime.addWorkflowInstance("session");
    await settle();
    controller.sendTaskInput("assistant", "Build a triage flow", "user");
    await settle();
    await settle();
    await settle();

    assert.equal(controller.getState().currentState, "done");
    const state = controller.getState()
      .workflowInstanceState as AuthoringItemState;
    assert.equal(state.report?.passed, true);
    // The lifecycle passed through revising on the way to done.
    const states = controller
      .getState()
      .history.filter((h) => h.type === "state_transition")
      .map((h) => (h.type === "state_transition" ? h.toState : ""));
    assert.ok(
      states.includes("revising"),
      `expected a revising round in the history, got: ${states.join(" → ")}`
    );
  });

  it("gives up after three failed finalize runs", async () => {
    // Draft + finish with a perpetually bad spec: three finalize failures
    // escalate to the failed terminal instead of revising forever.
    const badSpec = {
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
    const model = scriptedModel([
      setSpecCall(badSpec),
      finishCall,
      setSpecCall(badSpec),
      finishCall,
      setSpecCall(badSpec),
      finishCall,
    ]);
    const runtime = buildRuntime(model);
    const controller = runtime.addWorkflowInstance("session");
    await settle();
    controller.sendTaskInput("assistant", "Build a triage flow", "user");
    for (let i = 0; i < 8; i++) await settle();

    assert.equal(
      controller.getState().currentState,
      "failed",
      `expected failed after three finalize runs, got ${controller.getState().currentState}`
    );
  });

  it("set_flow_spec rejects invalid JSON and reports validation findings", async () => {
    const tool = authoringTools[0];
    assert.equal(tool.definition.function.name, "set_flow_spec");

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

  it("lucky mode drives the session autonomously (no user input, no finalize action)", async () => {
    const model = scriptedModel([
      setSpecCall(STRUCTURED_INTAKE_EXEMPLAR),
      finishCall,
    ]);
    const runtime = buildRuntime(model, "lucky");
    // The lucky workflow's drafting task declares its input and has no
    // finalize action — the agent is seeded and drives itself.
    const controller = runtime.addWorkflowInstance("session", {
      workflowInstanceState: {
        prompt: "Build a triage flow",
        mode: "lucky",
        luckyInput:
          "Produce the complete flow spec now. Do not ask clarifying questions — call set_flow_spec, then finish_authoring.\n\nRequest: Build a triage flow",
      },
    });
    const available = controller.getAvailableActions();
    assert.equal(
      available.some((a) => a.id === "finalize"),
      false,
      "lucky mode must not offer the finalize action"
    );

    // No sendTaskInput — the agent runs from its seeded input to done.
    for (let i = 0; i < 6; i++) await settle();

    assert.equal(
      controller.getState().currentState,
      "done",
      `lucky session should reach done autonomously, got ${controller.getState().currentState}`
    );
    const state = controller.getState()
      .workflowInstanceState as AuthoringItemState;
    assert.equal(state.report?.passed, true);
    assert.equal(state.mode, "lucky");
  });
});
