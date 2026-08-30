import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createFlowRuntime } from "workflow-engine/create-flow-runtime";
import type { AiChatModelCaller } from "workflow-engine/runners";
import { createAiChatRunner } from "workflow-engine/runners";
import { createEngineRunners } from "../../engine-bridge.ts";
import { queenBeeCompiled as queenBeeFlow } from "../compiled-presets.ts";

// The ideas workflow, extracted from the rendered definition (the old
// ideas-workflow.ts module was absorbed into the flow definition). The IIFE keeps
// the narrowing inside so the closure's type is RuntimeWorkflowConfig.
const ideasWorkflow = (() => {
  if (!("workflows" in queenBeeFlow)) {
    throw new Error("expected a static definition");
  }
  const workflow = queenBeeFlow.workflows.find((wf) => wf.id === "ideas");
  if (workflow === undefined) {
    throw new Error("ideas workflow not found");
  }
  return workflow;
})();

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
    operations: queenBeeFlow.operations,
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
          basePath: join(tmpdir(), "hive-ideas"),
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
