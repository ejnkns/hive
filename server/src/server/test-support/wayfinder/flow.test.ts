import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { flow as wayfinderFlow } from "../../../../../presets/wayfinder/flow.ts";
import { registerFlowDefinition } from "../../flow-definitions.ts";
import {
  dispatchFlowLevelAction,
  type FlowLevelActionDispatchResult,
  getAvailableFlowActions,
  registerFlowForTest,
  resetFlowRuntimesForTest,
} from "../../flow-registry.ts";
import {
  chartingCaller,
  idleModelCaller,
  makeWayfinderRuntime,
  waitFor,
} from "./test-helpers.ts";

describe("wayfinder flow-level actions", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join("/tmp", "hive-wayfinder-flow-"));
    resetFlowRuntimesForTest();
    registerFlowDefinition(wayfinderFlow);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("add_ticket creates a ticket in fog with normalized dependsOn", async () => {
    const runtime = makeWayfinderRuntime({
      aiChatCaller: chartingCaller(),
      aiTaskCaller: idleModelCaller(),
    });
    registerFlowForTest("wf-flow-a", runtime);
    await chartToCharted(runtime);

    const result = dispatchFlowLevelAction("wf-flow-a", "add_ticket", {
      title: "Choose the store",
      question: "localStorage or IndexedDB?",
      type: "research",
      dependsOn: "ticket-1, ticket-2",
    });

    const created = expectCreateInstance(result);
    const state = runtime
      .getWorkflowInstanceEntries()
      .find((entry) => entry.id === created.instance.id);
    assert.ok(state);
    assert.equal(state.state.currentState, "fog");
    assert.deepEqual(state.state.workflowInstanceState.dependsOn, [
      "ticket-1",
      "ticket-2",
    ]);
    assert.equal(state.state.workflowInstanceState.type, "research");
  });

  it("add_fog_entry creates a fog ticket whose title derives from the brief", async () => {
    const runtime = makeWayfinderRuntime({
      aiChatCaller: chartingCaller(),
      aiTaskCaller: idleModelCaller(),
    });
    registerFlowForTest("wf-flow-b", runtime);
    await chartToCharted(runtime);

    const result = dispatchFlowLevelAction("wf-flow-b", "add_fog_entry", {
      brief: "Something about caching is murky",
    });

    const created = expectCreateInstance(result);
    const state = runtime
      .getWorkflowInstanceEntries()
      .find((entry) => entry.id === created.instance.id);
    assert.ok(state);
    assert.equal(state.state.currentState, "fog");
    assert.equal(
      state.state.workflowInstanceState.title,
      "Something about caching is murky"
    );
    assert.equal(state.state.workflowInstanceState.type, "grilling");
    assert.deepEqual(state.state.workflowInstanceState.dependsOn, []);
  });

  it("add_ticket rejects unknown and missing required fields", async () => {
    const runtime = makeWayfinderRuntime({
      aiChatCaller: chartingCaller(),
      aiTaskCaller: idleModelCaller(),
    });
    registerFlowForTest("wf-flow-c", runtime);
    await chartToCharted(runtime);

    assert.throws(
      () =>
        dispatchFlowLevelAction("wf-flow-c", "add_ticket", {
          title: "X",
          type: "research",
          bogus: true,
        }),
      /Unknown field "bogus"/
    );
    assert.throws(
      () =>
        dispatchFlowLevelAction("wf-flow-c", "add_ticket", {
          question: "only a question",
        }),
      /Missing required field "title"/
    );
  });

  it("start_build is gated on a charted map with an empty frontier", async () => {
    const runtime = makeWayfinderRuntime({
      aiChatCaller: chartingCaller(),
      aiTaskCaller: idleModelCaller(),
    });
    registerFlowForTest("wf-flow-d", runtime);

    const hiddenBefore = getAvailableFlowActions("wf-flow-d");
    assert.ok(
      !hiddenBefore.some((action) => action.id === "start_build"),
      "start_build is hidden before the map is charted"
    );
    assert.ok(
      !hiddenBefore.some((action) => action.id === "add_ticket"),
      "add_ticket is hidden before the map is charted"
    );

    await chartToCharted(runtime);

    const available = getAvailableFlowActions("wf-flow-d");
    assert.ok(
      available.some((action) => action.id === "start_build"),
      "start_build appears once the map is charted and the frontier is clear"
    );
    assert.ok(
      available.some((action) => action.id === "add_ticket"),
      "add_ticket appears once the map is charted"
    );

    const result = dispatchFlowLevelAction("wf-flow-d", "start_build", {});
    const created = expectCreateInstance(result);
    const buildState = runtime
      .getWorkflowInstanceEntries()
      .find((entry) => entry.id === created.instance.id);
    assert.equal(buildState?.state.currentState, "specing");
  });

  it("start_build is gated while any ticket is open", async () => {
    const runtime = makeWayfinderRuntime({
      aiChatCaller: chartingCaller(),
      aiTaskCaller: idleModelCaller(),
    });
    registerFlowForTest("wf-flow-e", runtime);

    await chartToCharted(runtime);
    dispatchFlowLevelAction("wf-flow-e", "add_fog_entry", {
      brief: "Open fog entry",
    });

    assert.throws(
      () => dispatchFlowLevelAction("wf-flow-e", "start_build", {}),
      /not available/
    );
    const actions = getAvailableFlowActions("wf-flow-e");
    assert.ok(
      !actions.some((action) => action.id === "start_build"),
      "start_build stays hidden while fog remains"
    );
  });
});

// Narrow a flow-level action dispatch result to its create_instance variant.
function expectCreateInstance(
  result: FlowLevelActionDispatchResult
): Extract<FlowLevelActionDispatchResult, { kind: "create_instance" }> {
  if (result.kind !== "create_instance") {
    throw new Error("expected a create_instance dispatch result");
  }
  return result;
}

// Drives the runtime's charting instance through naming and frontier to the
// charted terminal using the mock charting caller.
async function chartToCharted(
  runtime: ReturnType<typeof makeWayfinderRuntime>
): Promise<void> {
  const controller = runtime.addWorkflowInstance("charting");
  controller.dispatchAction("start_charting");
  await waitFor(() => controller.getState().runningTaskId === "nameSession");
  controller.sendTaskInput("nameSession", "Sharpen the destination.", "user");
  await waitFor(
    () =>
      typeof controller.getState().workflowInstanceState.destination ===
      "string"
  );
  controller.dispatchAction("done");
  await waitFor(
    () => controller.getState().runningTaskId === "frontierSession"
  );
  controller.sendTaskInput("frontierSession", "Sweep the space.", "user");
  controller.dispatchAction("done");
  await waitFor(() => controller.getState().currentState === "charted");
}
