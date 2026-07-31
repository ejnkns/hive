import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  readBoard,
  readDraft,
  readRequirements,
  upsertCard,
  writeDraft,
  writeRequirements,
  writeReviewPackage,
} from "../../../../presets/queen-bee/domain-state";

describe("queen-bee domain state", () => {
  const dirs: string[] = [];

  function basePath(): string {
    const dir = mkdtempSync(join(tmpdir(), "hive-domain-state-"));
    dirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes and reads the requirements document", () => {
    const dir = basePath();
    const path = writeRequirements(dir, "# Requirements\n");
    assert.ok(existsSync(path));
    assert.equal(readRequirements(dir), "# Requirements\n");
    assert.equal(readRequirements(join(dir, "missing")), "");
  });

  it("writes and reads the draft", () => {
    const dir = basePath();
    writeDraft(dir, "# Draft\n");
    assert.equal(readDraft(dir), "# Draft\n");
    assert.equal(readDraft(join(dir, "missing")), "");
  });

  it("upserts cards onto the board", () => {
    const dir = basePath();
    upsertCard(dir, {
      id: "card-1",
      title: "Implement X",
      description: "Do the thing",
      acceptanceCriteria: ["works"],
      status: "ready",
      dependsOn: [],
      createdAt: "2026-08-01T00:00:00.000Z",
    });

    const board = readBoard(dir);
    assert.equal(board.cards.length, 1);
    assert.equal(board.cards[0]?.title, "Implement X");
    assert.equal(board.cards[0]?.status, "ready");

    upsertCard(dir, {
      id: "card-1",
      title: "Implement X",
      description: "Do the thing",
      acceptanceCriteria: ["works"],
      status: "in_progress",
      dependsOn: [],
      createdAt: "2026-08-01T00:00:00.000Z",
    });
    assert.equal(readBoard(dir).cards.length, 1);
    assert.equal(readBoard(dir).cards[0]?.status, "in_progress");
  });

  it("returns an empty board for a missing file", () => {
    assert.deepEqual(readBoard(join(basePath(), "missing")), {
      cards: [],
      ideas: [],
    });
  });

  it("writes a review package", () => {
    const dir = basePath();
    const path = writeReviewPackage(dir, {
      packageId: "pkg-1",
      cardId: "card-1",
      attempt: 1,
      spec: {
        title: "Implement X",
        description: "Do the thing",
        acceptanceCriteria: ["works"],
        dependsOn: [],
      },
      requirements: "# Requirements\n",
      baseCommit: "base",
      workerHead: "head",
      diff: "src/x.ts | 2 ++",
      createdAt: "2026-08-01T00:00:00.000Z",
    });
    assert.ok(existsSync(path));
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as {
      packageId: string;
    };
    assert.equal(parsed.packageId, "pkg-1");
  });
});
