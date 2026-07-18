import assert from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { createBoardStore } from "./board-store";

describe("BoardStore", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("updates a card without losing its persisted handover state", () => {
    const repoPath = createRepo();
    const store = createBoardStore(() => {});
    const card = store.addCard("project-1", repoPath, {
      title: "Add a feature",
      description: "Initial requirements",
      acceptanceCriteria: ["It works"],
      relevantFiles: ["src/app.ts"],
      dependencies: [],
      column: "unfulfillable",
      handover: {
        problem: "The dependency is unavailable",
        attempted: ["Installed the dependency"],
        blockedBy: ["Package registry outage"],
        occurredAt: "2026-07-18T00:00:00.000Z",
      },
    });

    const updated = store.updateCard("project-1", repoPath, card.id, {
      description: "Revised requirements",
      requirementRefs: ["FR-2", "AC-2"],
    });

    assert.strictEqual(updated.description, "Revised requirements");
    assert.deepStrictEqual(updated.requirementRefs, ["FR-2", "AC-2"]);
    assert.deepStrictEqual(updated.handover, card.handover);

    const saved = JSON.parse(
      readFileSync(join(repoPath, ".hive", "board.json"), "utf-8")
    ) as { cards: Array<{ handover?: unknown; requirementRefs?: string[] }> };
    assert.deepStrictEqual(saved.cards[0]?.handover, card.handover);
    assert.deepStrictEqual(saved.cards[0]?.requirementRefs, ["FR-2", "AC-2"]);
  });

  it("soft archives a card while preserving its record on disk", () => {
    const repoPath = createRepo();
    const store = createBoardStore(() => {});
    const card = store.addCard("project-1", repoPath, {
      title: "Archive me",
      description: "",
      acceptanceCriteria: [],
      relevantFiles: ["src/app.ts"],
      dependencies: [],
      column: "unfulfillable",
    });

    const archived = store.archiveCard("project-1", repoPath, card.id);

    assert.ok(archived.archivedAt);
    assert.strictEqual(store.getBoard("project-1", repoPath).cards.length, 0);
    assert.strictEqual(
      JSON.parse(
        readFileSync(
          join(repoPath, ".hive", "cards", `${card.id}.json`),
          "utf-8"
        )
      ).archivedAt,
      archived.archivedAt
    );
  });

  function createRepo(): string {
    const repoPath = mkdtempSync(join(tmpdir(), "hive-board-store-"));
    directories.push(repoPath);
    mkdirSync(join(repoPath, "src"), { recursive: true });
    return repoPath;
  }
});
