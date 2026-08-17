import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  chartingCaller,
  chatReply,
  chatRespond,
  chatToolCall,
  chatToolCalls,
  idleModelCaller,
  makeWayfinderRuntime,
  waitFor,
} from "./test-helpers.ts";

describe("wayfinder charting workflow", () => {
  const tempDirs: string[] = [];

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "hive-wayfinder-charting-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("charts the map: naming, then frontier, patching destination and persisting map.md", async () => {
    const basePath = tempDir();
    const runtime = makeWayfinderRuntime({
      basePath,
      aiChatCaller: chartingCaller(),
      aiTaskCaller: idleModelCaller(),
    });

    // Creation seeds the charting instance in the naming state with the
    // creation-time destination; the naming session starts immediately.
    const controller = runtime.addWorkflowInstance("charting", {
      workflowInstanceState: { destination: "A loose effort", notes: "" },
    });
    assert.equal(controller.getState().currentState, "naming");

    // The seeded destination opens the naming session as its first user
    // message — the agent engages immediately (no wait for the human to
    // start), sharpening the destination from the seed alone.
    await waitFor(() => controller.getState().runningTaskId === "nameSession");
    await waitFor(() => {
      const state = controller.getState().workflowInstanceState;
      return state.destination === "Ship the code editor";
    });
    // The human reacts to the sharpened destination, then presses Done.
    controller.sendTaskInput(
      "nameSession",
      "It is the editor work we keep deferring.",
      "user"
    );
    controller.dispatchAction("done");

    // Entering frontier runs the settle operation (patches flow config and
    // persists map.md) before the frontier session starts.
    await waitFor(() => controller.getState().currentState === "frontier");
    const config = runtime.getFlowConfig();
    assert.equal(config.destination, "Ship the code editor");
    assert.equal(config.notes, "TypeScript; prioritise correctness over speed");
    await waitFor(() => existsSync(join(basePath, ".wayfinder", "map.md")));
    const mapBody = readFileSync(
      join(basePath, ".wayfinder", "map.md"),
      "utf-8"
    );
    assert.match(mapBody, /Ship the code editor/);

    // The frontier session surfaces the map; the human's Done closes charting.
    await waitFor(
      () => controller.getState().runningTaskId === "frontierSession"
    );
    controller.sendTaskInput(
      "frontierSession",
      "Sweep the whole space.",
      "user"
    );
    controller.dispatchAction("done");
    await waitFor(() => controller.getState().currentState === "charted");
  });

  it("the frontier session tickets the surveyed surface via create_instance", async () => {
    const basePath = tempDir();
    const runtime = makeWayfinderRuntime({
      basePath,
      // The single caller scripts both sessions: naming settles the map,
      // then the frontier session converts its survey into tickets.
      aiChatCaller: chatRespond(
        chatToolCall("submit_map", {
          destination: "Adopt Effect",
          notes: "Engine-first, in slices",
        }),
        chatReply("Map recorded — press Done."),
        chatToolCalls([
          {
            name: "create_instance",
            args: {
              workflowId: "ticket",
              instanceState: {
                title: "Effect dep mode",
                question: "npm publish or source link to ./effect?",
                type: "research",
              },
            },
          },
          {
            name: "create_instance",
            args: {
              workflowId: "ticket",
              instanceState: {
                title: "Plain registry",
                question: "How to record intentionally-plain modules?",
                type: "grilling",
              },
            },
          },
          {
            name: "create_instance",
            args: {
              workflowId: "ticket",
              instanceState: {
                brief: "Fog item we cannot sharpen yet",
              },
            },
          },
        ]),
        chatReply(
          "The surface is ticketed — review the fog and graduate, then press Done."
        )
      ),
      aiTaskCaller: idleModelCaller(),
    });

    const controller = runtime.addWorkflowInstance("charting", {
      workflowInstanceState: { destination: "Adopt Effect", notes: "" },
    });
    // Complete naming to reach the frontier session.
    await waitFor(() => controller.getState().runningTaskId === "nameSession");
    await waitFor(
      () =>
        controller.getState().workflowInstanceState.destination ===
        "Adopt Effect"
    );
    controller.dispatchAction("done");
    await waitFor(() => controller.getState().currentState === "frontier");

    // The frontier session creates the tickets automatically; each lands in
    // the fog state (the ticket workflow's initial) and is normalized.
    await waitFor(
      () =>
        runtime
          .getWorkflowInstanceEntries()
          .filter((entry) => entry.workflowId === "ticket").length === 3
    );
    const tickets = runtime
      .getWorkflowInstanceEntries()
      .filter((entry) => entry.workflowId === "ticket");
    assert.ok(
      tickets.every((ticket) => ticket.state.currentState === "fog"),
      "created tickets start in the fog"
    );
    const titles = tickets
      .map((ticket) => ticket.state.workflowInstanceState.title)
      .sort();
    assert.deepEqual(titles, [
      "Effect dep mode",
      "Fog item we cannot sharpen yet",
      "Plain registry",
    ]);
    const research = tickets.find(
      (ticket) => ticket.state.workflowInstanceState.title === "Effect dep mode"
    );
    assert.equal(research?.state.workflowInstanceState.type, "research");
    assert.equal(
      research?.state.workflowInstanceState.question,
      "npm publish or source link to ./effect?"
    );

    // Finish charting.
    await waitFor(
      () => controller.getState().runningTaskId === "frontierSession"
    );
    controller.sendTaskInput(
      "frontierSession",
      "Looks good — graduate them.",
      "user"
    );
    controller.dispatchAction("done");
    await waitFor(() => controller.getState().currentState === "charted");
  });
});
