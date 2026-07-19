import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { createQueenBeeRuntimeStore } from "./queen-bee-runtime-store";
import type { ReviewPackage } from "./reviewer";

describe("QueenBeeRuntimeStore", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("persists immutable Review Packages outside the project repository", () => {
    const rootDirectory = createRoot();
    const store = createQueenBeeRuntimeStore(rootDirectory);
    const reviewPackage = packageFixture("package-1");

    store.saveReviewPackage("project-1", reviewPackage);

    assert.deepEqual(
      store.getReviewPackage("project-1", reviewPackage.id),
      reviewPackage
    );
    assert.throws(
      () =>
        store.saveReviewPackage("project-1", {
          ...reviewPackage,
          card: { ...reviewPackage.card, title: "Mutated" },
        }),
      /immutable/
    );
  });

  it("defaults legacy Review Packages to reviewing their Worker head", () => {
    const rootDirectory = createRoot();
    const packageDirectory = join(
      rootDirectory,
      "queen-bee",
      "projects",
      "project-1",
      "review-packages"
    );
    mkdirSync(packageDirectory, { recursive: true });
    const legacyPackage = packageFixture("legacy-package");
    const { reviewCommit: _reviewCommit, ...legacyRevisions } =
      legacyPackage.revisions;
    writeFileSync(
      join(packageDirectory, "legacy-package.json"),
      JSON.stringify({
        ...legacyPackage,
        revisions: legacyRevisions,
      })
    );

    const restored = createQueenBeeRuntimeStore(rootDirectory).getReviewPackage(
      "project-1",
      "legacy-package"
    );

    assert.equal(restored?.revisions.reviewCommit, "head-1");
  });

  it("replays actor-labelled card activity in insertion order", () => {
    const store = createQueenBeeRuntimeStore(createRoot());
    store.appendActivity("project-1", "card-1", {
      actor: "worker",
      type: "tool",
      summary: "Worker Agent ran tests",
      detail: "pnpm test",
    });
    store.appendActivity("project-1", "card-1", {
      actor: "reviewer",
      type: "decision",
      summary: "Reviewer Agent approved the Review Package",
    });

    const activity = store.getActivity("project-1", "card-1");
    assert.deepEqual(
      activity.map((event) => [event.actor, event.summary]),
      [
        ["worker", "Worker Agent ran tests"],
        ["reviewer", "Reviewer Agent approved the Review Package"],
      ]
    );
    assert.ok(activity[0]?.id);
    assert.ok(activity[0]?.occurredAt);
  });

  it("persists operational card state separately from card specifications", () => {
    const store = createQueenBeeRuntimeStore(createRoot());
    store.saveCardState("project-1", "card-1", {
      column: "reviewing",
      reviewerLog: {
        status: "error",
        error: "Retryable",
        reviewedAt: "2026-07-19T00:00:00.000Z",
      },
      workAttempts: [],
    });

    assert.deepEqual(store.getCardState("project-1", "card-1"), {
      column: "reviewing",
      reviewerLog: {
        status: "error",
        error: "Retryable",
        reviewedAt: "2026-07-19T00:00:00.000Z",
      },
      workAttempts: [],
    });
  });

  it("persists complete Requirements Sessions under the shared Hive directory", () => {
    const rootDirectory = createRoot();
    const store = createQueenBeeRuntimeStore(rootDirectory);
    store.saveRequirementsSession({
      sessionId: "session-1",
      projectId: "project-1",
      messages: [{ role: "user", content: "Build it" }],
      status: "active",
      kind: "initial_requirements",
      baseRequirementsRevision: "requirements-1",
      projectRevision: "revision-1",
      draftRequirements: "# Draft",
      startedAt: "2026-07-19T00:00:00.000Z",
      updatedAt: "2026-07-19T00:01:00.000Z",
    });

    assert.equal(
      existsSync(
        join(
          rootDirectory,
          "requirements-sessions",
          "project-1",
          "session-1.json"
        )
      ),
      true
    );
    assert.equal(
      store.getRequirementsSessions("project-1")[0]?.draftRequirements,
      "# Draft"
    );
  });

  function createRoot(): string {
    const directory = mkdtempSync(join(tmpdir(), "hive-runtime-"));
    directories.push(directory);
    return directory;
  }

  function packageFixture(id: string): ReviewPackage {
    return {
      id,
      card: {
        id: "card-1",
        title: "Implement feature",
        description: "Description",
        acceptanceCriteria: ["It works"],
        requirementRefs: ["FR-1"],
      },
      requirements: { revision: "requirements-1", content: "Requirements" },
      revisions: {
        baseCommit: "base-1",
        headCommit: "head-1",
        reviewCommit: "head-1",
        integrationCommit: "integration-1",
        cardRevision: "card-1-revision",
      },
      commits: [{ sha: "head-1", subject: "feature: implement" }],
      changedFiles: ["source.ts"],
      diff: "diff",
      diffStat: "1 file changed",
      verification: { commands: [] },
    };
  }
});
