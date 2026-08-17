import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  chartingCaller,
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
});
