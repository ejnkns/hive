import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { createBoardStore } from "./board-store";
import type { DeviseModelCaller } from "./devise-engine/create-devise-model-caller";
import type { IntegrationManager } from "./integration-manager";
import { createPlanner } from "./planner";
import { createQueenBeeRuntimeStore } from "./queen-bee-runtime-store";
import { readRequirements, writeRequirements } from "./requirements-store";

describe("Planner Agent reconciliation", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps proposals provisional until every card decision is applied", async () => {
    const repoPath = createWorkspace();
    const runtimeStore = createQueenBeeRuntimeStore(join(repoPath, ".runtime"));
    const boardStore = createBoardStore(() => {}, runtimeStore);
    const idea = boardStore.addCard("project-1", repoPath, {
      title: "Old idea",
      description: "Old description",
      acceptanceCriteria: ["Old behavior"],
      relevantFiles: ["source.ts"],
      dependencies: [],
      column: "idea",
    });
    const done = boardStore.addCard("project-1", repoPath, {
      title: "Accepted feature",
      description: "Immutable",
      acceptanceCriteria: ["Already accepted"],
      relevantFiles: ["source.ts"],
      dependencies: [],
      column: "done",
    });
    const planner = createPlanner(
      boardStore,
      runtimeStore,
      integrationManager(),
      responseCaller({
        changes: [
          {
            action: "update",
            cardId: idea.id,
            rationale: "The requirement changed",
            proposedCard: cardSpec("Revised idea"),
          },
          { action: "keep", cardId: done.id, rationale: "Already aligned" },
          {
            action: "create",
            rationale: "Optional addition",
            proposedCard: cardSpec("Optional card"),
          },
        ],
      })
    );

    const proposal = await planner.propose(
      "project-1",
      repoPath,
      "# Proposed requirements"
    );
    assert.equal(
      boardStore.getBoard("project-1", repoPath).cards[0]?.title,
      "Old idea"
    );
    planner.decide("project-1", proposal.id, "change-0", "accepted");
    planner.decide("project-1", proposal.id, "change-2", "rejected");
    const cards = planner.apply("project-1", repoPath, proposal.id);

    assert.deepEqual(
      cards.map((card) => card.title),
      ["Revised idea", "Accepted feature"]
    );
    assert.equal(readRequirements(repoPath), "# Proposed requirements");
  });

  it("rejects plans that mutate accepted or active cards", async () => {
    const repoPath = createWorkspace();
    const runtimeStore = createQueenBeeRuntimeStore(join(repoPath, ".runtime"));
    const boardStore = createBoardStore(() => {}, runtimeStore);
    const done = boardStore.addCard("project-1", repoPath, {
      title: "Accepted feature",
      description: "Immutable",
      acceptanceCriteria: ["Already accepted"],
      relevantFiles: ["source.ts"],
      dependencies: [],
      column: "done",
    });
    const planner = createPlanner(
      boardStore,
      runtimeStore,
      integrationManager(),
      responseCaller({
        changes: [
          {
            action: "remove",
            cardId: done.id,
            rationale: "Try to erase history",
          },
        ],
      })
    );

    await assert.rejects(
      () => planner.propose("project-1", repoPath, "# Proposed"),
      /may not remove done card/
    );
  });

  it("rolls back requirements and cards when the planning commit fails", async () => {
    const repoPath = createWorkspace();
    const runtimeStore = createQueenBeeRuntimeStore(join(repoPath, ".runtime"));
    const boardStore = createBoardStore(() => {}, runtimeStore);
    const idea = boardStore.addCard("project-1", repoPath, {
      title: "Original card",
      description: "Original",
      acceptanceCriteria: ["Original behavior"],
      relevantFiles: ["source.ts"],
      dependencies: [],
      column: "idea",
    });
    const planner = createPlanner(
      boardStore,
      runtimeStore,
      integrationManager(true),
      responseCaller({
        changes: [
          {
            action: "update",
            cardId: idea.id,
            rationale: "Change it",
            proposedCard: cardSpec("Changed card"),
          },
        ],
      })
    );
    const proposal = await planner.propose(
      "project-1",
      repoPath,
      "# Changed requirements"
    );
    planner.decide("project-1", proposal.id, "change-0", "accepted");

    assert.throws(
      () => planner.apply("project-1", repoPath, proposal.id),
      /Commit hook rejected/
    );
    assert.equal(readRequirements(repoPath), "# Original requirements");
    assert.equal(
      boardStore.getBoard("project-1", repoPath).cards[0]?.title,
      "Original card"
    );
  });

  function createWorkspace(): string {
    const repoPath = mkdtempSync(join(tmpdir(), "hive-planner-"));
    directories.push(repoPath);
    writeRequirements(repoPath, "# Original requirements");
    return repoPath;
  }

  function responseCaller(output: unknown): DeviseModelCaller {
    return {
      async call() {
        return {
          content: `\`\`\`json\n${JSON.stringify(output)}\n\`\`\``,
          toolCalls: [],
          finishReason: "stop",
        };
      },
    };
  }

  function integrationManager(commitFails = false): IntegrationManager {
    return {
      ensure: () => ({ branchName: "hive-main", revision: "integration-1" }),
      assertCurrent: () => {},
      accept: () => ({ branchName: "hive-main", revision: "integration-2" }),
      discardWorktree: () => {},
      commitPlanningSnapshot: () => {
        if (commitFails) throw new Error("Commit hook rejected");
        return {
          branchName: "hive-main",
          revision: "integration-2",
        };
      },
    };
  }

  function cardSpec(title: string) {
    return {
      title,
      description: `${title} description`,
      acceptanceCriteria: [`${title} works`],
      relevantFiles: ["source.ts"],
      dependencies: [],
      requirementRefs: ["FR-1"],
    };
  }
});
