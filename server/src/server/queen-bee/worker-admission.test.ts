import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Card } from "./board-store";
import { evaluateWorkerAdmission } from "./worker-admission";

describe("evaluateWorkerAdmission", () => {
  it("admits independent work below the Project concurrency limit", () => {
    const admission = evaluateWorkerAdmission({
      card: card("target", { relevantFiles: ["src/target.ts"] }),
      cards: [
        card("target", { relevantFiles: ["src/target.ts"] }),
        card("active", {
          column: "in_progress",
          relevantFiles: ["src/active.ts"],
        }),
      ],
      runningCardIds: ["active"],
      maxConcurrentWorkers: 3,
      confirmRisks: false,
    });

    assert.deepEqual(admission, {
      allowed: true,
      canOverride: false,
      activeWorkers: 1,
      maxConcurrentWorkers: 3,
      blockers: [],
    });
  });

  it("requires explicit confirmation for unmet dependencies and overlapping files", () => {
    const target = card("target", {
      dependencies: ["dependency"],
      relevantFiles: ["src/shared.ts", "src/target.ts"],
    });
    const cards = [
      target,
      card("dependency", { column: "ready" }),
      card("active", {
        column: "in_progress",
        relevantFiles: ["src/shared.ts"],
      }),
    ];

    const blocked = evaluateWorkerAdmission({
      card: target,
      cards,
      runningCardIds: ["active"],
      maxConcurrentWorkers: 3,
      confirmRisks: false,
    });

    assert.equal(blocked.allowed, false);
    assert.equal(blocked.canOverride, true);
    assert.deepEqual(
      blocked.blockers.map((blocker) => blocker.kind),
      ["dependency", "file_overlap"]
    );
    assert.deepEqual(blocked.blockers[1]?.files, ["src/shared.ts"]);

    assert.equal(
      evaluateWorkerAdmission({
        card: target,
        cards,
        runningCardIds: ["active"],
        maxConcurrentWorkers: 3,
        confirmRisks: true,
      }).allowed,
      true
    );
  });

  it("never overrides the Project concurrency limit", () => {
    const target = card("target");
    const admission = evaluateWorkerAdmission({
      card: target,
      cards: [target, card("one"), card("two")],
      runningCardIds: ["one", "two"],
      maxConcurrentWorkers: 2,
      confirmRisks: true,
    });

    assert.equal(admission.allowed, false);
    assert.equal(admission.canOverride, false);
    assert.deepEqual(
      admission.blockers.map((blocker) => blocker.kind),
      ["capacity"]
    );
  });
});

function card(id: string, patch: Partial<Card> = {}): Card {
  return {
    id,
    title: id,
    description: `${id} description`,
    acceptanceCriteria: [`${id} works`],
    relevantFiles: [`src/${id}.ts`],
    dependencies: [],
    column: "ready",
    createdAt: "2026-07-19T00:00:00.000Z",
    ...patch,
  };
}
