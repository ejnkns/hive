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
} from "./test-helpers";

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

    const controller = runtime.addWorkflowInstance("charting");
    assert.equal(controller.getState().currentState, "no_session");

    controller.dispatchAction("start_charting");
    assert.equal(controller.getState().currentState, "naming");

    // The naming session sharpens the destination. The charting caller records
    // the destination via submit_map on its first call, then waits.
    await waitFor(() => controller.getState().runningTaskId === "nameSession");
    controller.sendTaskInput(
      "nameSession",
      "Sharpen the destination for the effort.",
      "user"
    );
    await waitFor(() => {
      const state = controller.getState().workflowInstanceState;
      return typeof state.destination === "string" && state.destination !== "";
    });
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
