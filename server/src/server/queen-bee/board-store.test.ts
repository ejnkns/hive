import assert from "node:assert";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { createBoardStore } from "./board-store";
import { createQueenBeeRuntimeStore } from "./queen-bee-runtime-store";

describe("BoardStore", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("updates a card without losing its persisted handover state", () => {
    const repoPath = createRepo();
    const runtimeStore = createQueenBeeRuntimeStore(join(repoPath, ".runtime"));
    const store = createBoardStore(() => {}, runtimeStore);
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

    const savedSpecification = JSON.parse(
      readFileSync(join(repoPath, ".hive", "board.json"), "utf-8")
    ) as { cards: Array<{ handover?: unknown; requirementRefs?: string[] }> };
    assert.equal(savedSpecification.cards[0]?.handover, undefined);
    assert.deepStrictEqual(savedSpecification.cards[0]?.requirementRefs, [
      "FR-2",
      "AC-2",
    ]);
    assert.deepStrictEqual(
      runtimeStore.getCardState("project-1", card.id)?.handover,
      card.handover
    );
  });

  it("soft archives a card while preserving its record on disk", () => {
    const repoPath = createRepo();
    const runtimeStore = createQueenBeeRuntimeStore(join(repoPath, ".runtime"));
    const store = createBoardStore(() => {}, runtimeStore);
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
    const savedSpecification = JSON.parse(
      readFileSync(join(repoPath, ".hive", "cards", `${card.id}.json`), "utf-8")
    ) as { archivedAt?: string };
    assert.equal(savedSpecification.archivedAt, undefined);
    assert.strictEqual(
      runtimeStore.getCardState("project-1", card.id)?.archivedAt,
      archived.archivedAt
    );
  });

  it("migrates legacy repository runtime fields on the next card write", () => {
    const repoPath = createRepo();
    const runtimeStore = createQueenBeeRuntimeStore(join(repoPath, ".runtime"));
    mkdirSync(join(repoPath, ".hive"), { recursive: true });
    writeFileSync(
      join(repoPath, ".hive", "board.json"),
      JSON.stringify({
        projectId: "project-1",
        cards: [
          {
            id: "legacy-card",
            title: "Legacy card",
            description: "Legacy state",
            acceptanceCriteria: ["State migrates"],
            relevantFiles: ["src/app.ts"],
            dependencies: [],
            column: "reviewing",
            createdAt: "2026-07-18T00:00:00.000Z",
            reviewerLog: {
              verdict: "pass",
              feedback: "Legacy approval",
              reviewedAt: "2026-07-18T01:00:00.000Z",
            },
          },
        ],
      })
    );
    const store = createBoardStore(() => {}, runtimeStore);

    const legacy = store.getBoard("project-1", repoPath).cards[0];
    assert.equal(legacy?.column, "reviewing");
    assert.equal(legacy?.reviewerLog?.verdict, "approved");
    store.updateCard("project-1", repoPath, "legacy-card", {
      description: "Migrated state",
    });

    assert.equal(
      runtimeStore.getCardState("project-1", "legacy-card")?.column,
      "reviewing"
    );
    const canonical = JSON.parse(
      readFileSync(join(repoPath, ".hive", "board.json"), "utf-8")
    ) as { cards: Array<{ column?: string; reviewerLog?: unknown }> };
    assert.equal(canonical.cards[0]?.column, undefined);
    assert.equal(canonical.cards[0]?.reviewerLog, undefined);
  });

  function createRepo(): string {
    const repoPath = mkdtempSync(join(tmpdir(), "hive-board-store-"));
    directories.push(repoPath);
    mkdirSync(join(repoPath, "src"), { recursive: true });
    return repoPath;
  }
});
