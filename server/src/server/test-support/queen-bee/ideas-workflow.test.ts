import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFlowRuntime } from "workflow-engine/create-flow-runtime";
import type { AiChatModelCaller } from "workflow-engine/runners";
import { createAiChatRunner } from "workflow-engine/runners";
import {
  queenBeeFlow,
  queenBeeOperations,
} from "../../../../../presets/queen-bee/flow";
import { ideasWorkflow } from "../../../../../presets/queen-bee/ideas-workflow";
import { createEngineRunners } from "../../engine-bridge";

describe("ideas workflow completion", () => {
  it("elaborate completes and advances to submitted once the agent signals IDEA_COMPLETE", async () => {
    const runtime = makeIdeasRuntime({
      modelCaller: completingIdeasCaller(),
    });

    const controller = runtime.addWorkflowInstance("ideas", {
      workflowInstanceState: { title: "Idea", brief: "Initial brief" },
    });

    assert.equal(controller.getState().currentState, "backlog");

    controller.dispatchAction("elaborate");
    assert.equal(controller.getState().currentState, "elaborating");

    controller.sendTaskInput(
      "elaborate",
      "Add a dark mode toggle to the app.",
      "user"
    );

    await waitFor(() => controller.getState().currentState === "refined");

    assert.equal(controller.getState().currentState, "refined");
    const elaborate = controller.getState().taskOutputs.elaborate;
    assert.equal(elaborate?.status, "success");
    const output = elaborate?.output as { content: string };
    assert.match(output.content, /IDEA_COMPLETE/);
    assert.match(output.content, /dark mode/);

    controller.dispatchAction("approve");
    assert.equal(controller.getState().currentState, "submitted");
  });
});

function makeIdeasRuntime(options: {
  modelCaller: AiChatModelCaller;
}): ReturnType<typeof createFlowRuntime> {
  const flowConfig = { definitionId: "queen-bee", name: "Project" };
  const baseRunners = createEngineRunners({
    tools: queenBeeFlow.tools,
    operations: queenBeeOperations,
  });
  return createFlowRuntime(
    "project",
    [ideasWorkflow],
    [],
    {
      "ai-chat": (ctx) =>
        createAiChatRunner({
          modelCaller: options.modelCaller,
          toolDefinitions: baseRunners.toolDefinitions,
          toolExecutors: baseRunners.toolExecutors,
          instanceId: ctx.instanceId,
          patchWorkflowInstanceState: ctx.patchWorkflowInstanceState,
          workflowInstanceState: ctx.workflowInstanceState,
          patchRunningTaskMessages: ctx.patchRunningTaskMessages,
          createWorkflowInstance: ctx.createWorkflowInstance,
        }),
    },
    flowConfig
  );
}

function completingIdeasCaller(): AiChatModelCaller {
  return async () => ({
    content:
      "## Idea brief\n\n### Problem\nThe app has no dark mode.\n\n### Proposed behaviour\nA toggle on the settings screen switches the theme.\n\n### Scope boundaries\nClient-side theming only.\n\n### Open decisions\nDefault theme for new users.\n\nIDEA_COMPLETE",
  });
}

async function waitFor(
  condition: () => boolean,
  timeoutMs = 5_000
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
