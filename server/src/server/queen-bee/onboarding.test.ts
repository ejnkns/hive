import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { FlowPersistence } from "workflow-engine/create-flow-runtime";
import { queenBeeFlow } from "../../../../presets/queen-bee/flow";
import { createFlowPersistence } from "../flow-persistence";
import {
  createFlow,
  getFlowRuntime,
  registerFlowDefinition,
  setFlowPersistence,
} from "../flow-registry";

describe("queen-bee onboarding workflow", () => {
  let root: string;
  let repoPath: string;
  let persistence: FlowPersistence;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hive-onboarding-"));
    repoPath = join(root, "repo");
    mkdirSync(repoPath);
    execSync("git init -b main", { cwd: repoPath, encoding: "utf-8" });
    execSync("git config user.email test@example.com", {
      cwd: repoPath,
      encoding: "utf-8",
    });
    execSync("git config user.name Test", { cwd: repoPath, encoding: "utf-8" });
    execSync("git commit --allow-empty -m initial", {
      cwd: repoPath,
      encoding: "utf-8",
    });

    persistence = createFlowPersistence(join(root, "hive"));
    setFlowPersistence(persistence);
    registerFlowDefinition(queenBeeFlow);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("binds a repository and seeds requirements and integration", async () => {
    createFlow("my-project", "queen-bee", persistence, {
      repoPath,
      name: "My Project",
    });

    const runtime = getFlowRuntime("my-project");
    assert.ok(runtime);
    await waitFor(() => {
      const onboarding = runtime
        .getWorkflowInstanceEntries()
        .find((entry) => entry.workflowId === "onboarding");
      return onboarding?.state.currentState === "complete";
    });

    const config = runtime.getFlowConfig() as Record<string, unknown>;
    assert.equal(config.repoPath, repoPath);
    assert.equal(config.targetBranch, "main");
    assert.equal(config.name, "My Project");

    const projectJson = JSON.parse(
      readFileSync(join(repoPath, ".hive", "project.json"), "utf-8")
    ) as { repoPath: string; targetBranch: string };
    assert.equal(projectJson.repoPath, repoPath);
    assert.equal(projectJson.targetBranch, "main");

    assert.ok(existsSync(join(repoPath, ".hive", "project.json")));

    await waitFor(() => {
      const entries = runtime.getWorkflowInstanceEntries();
      return (
        entries.some((entry) => entry.workflowId === "requirements") &&
        entries.some((entry) => entry.workflowId === "integration")
      );
    });
  });

  it("moves to failed for a non-repository path", async () => {
    const badPath = join(root, "not-a-repo");
    mkdirSync(badPath);

    createFlow("bad-project", "queen-bee", persistence, {
      repoPath: badPath,
      name: "Bad Project",
    });

    const runtime = getFlowRuntime("bad-project");
    assert.ok(runtime);
    await waitFor(() => {
      const onboarding = runtime
        .getWorkflowInstanceEntries()
        .find((entry) => entry.workflowId === "onboarding");
      return onboarding?.state.currentState === "failed";
    });
  });
});

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
