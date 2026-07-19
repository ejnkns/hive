import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import type { ReviewReadiness } from "shared/board-types";
import type { ProjectListItem } from "shared/project-types";
import { createBoardStore } from "./board-store";
import type { ProjectStore } from "./create-project-store";
import type { IntegrationManager } from "./integration-manager";
import { createQueenBeeRuntimeStore } from "./queen-bee-runtime-store";
import type { buildRefreshedReviewPackage } from "./review-package";
import type { Reviewer, ReviewPackage } from "./reviewer";
import { registerWorkDecisionRoutes } from "./work-decision-routes";

describe("work decision routes", () => {
  const directories: string[] = [];
  const servers: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("marks reviewed work done only after an explicit acceptance", async () => {
    const fixture = createFixture();
    const card = fixture.reviewedCard();

    const response = await fixture.server.inject({
      method: "POST",
      url: `/api/queen-bee/${fixture.project.id}/cards/${card.id}/accept`,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().card.column, "done");
    assert.equal(response.json().card.workAttempts[0].status, "accepted");
    assert.equal(fixture.acceptedBranches[0], "hive/card-1/attempt-1");
  });

  it("requires guidance when requesting another Worker Agent attempt", async () => {
    const fixture = createFixture();
    const card = fixture.reviewedCard();

    const response = await fixture.server.inject({
      method: "POST",
      url: `/api/queen-bee/${fixture.project.id}/cards/${card.id}/request-changes`,
      payload: { guidance: "" },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(
      fixture.boardStore.getBoard(fixture.project.id, fixture.project.repoPath)
        .cards[0]?.column,
      "reviewing"
    );
  });

  it("preserves the rejected branch and returns the card to Ready", async () => {
    const fixture = createFixture();
    const card = fixture.reviewedCard();

    const response = await fixture.server.inject({
      method: "POST",
      url: `/api/queen-bee/${fixture.project.id}/cards/${card.id}/request-changes`,
      payload: { guidance: "Handle the empty-state case." },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().card.column, "ready");
    assert.equal(
      response.json().card.workAttempts[0].decision.guidance,
      "Handle the empty-state case."
    );
    assert.deepEqual(fixture.discardedWorktrees, ["/tmp/card-1"]);
    assert.equal(
      fixture.runtimeStore.getActivity(fixture.project.id, card.id)[0]?.actor,
      "user"
    );
  });

  it("retries only the immutable Review Package after a Reviewer Agent error", async () => {
    const fixture = createFixture();
    const card = fixture.reviewedCard();
    fixture.runtimeStore.saveReviewPackage(
      fixture.project.id,
      reviewPackage(card.id)
    );
    fixture.boardStore.updateCard(
      fixture.project.id,
      fixture.project.repoPath,
      card.id,
      {
        reviewerLog: {
          status: "error",
          error: "Invalid review submission",
          reviewPackageId: "package-1",
          reviewedAt: "2026-07-19T00:00:00.000Z",
        },
        workAttempts: card.workAttempts?.map((attempt) => ({
          ...attempt,
          status: "review_error" as const,
        })),
      }
    );

    const response = await fixture.server.inject({
      method: "POST",
      url: `/api/queen-bee/${fixture.project.id}/cards/${card.id}/restart-review`,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().card.column, "reviewing");
    assert.equal(response.json().card.reviewerLog.verdict, "approved");
    assert.equal(fixture.reviewCalls, 1);
  });

  it("creates a new immutable Review Package when hive-main advanced cleanly", async () => {
    let refreshedBase = "";
    const fixture = createFixture({
      readinessState: "stale",
      refreshedReviewBuilder(
        card,
        _repoPath,
        _worktreePath,
        integrationCommit
      ) {
        refreshedBase = integrationCommit;
        const refreshed = reviewPackage(card.id);
        return {
          reviewPackage: {
            ...refreshed,
            id: "package-2",
            revisions: {
              ...refreshed.revisions,
              baseCommit: integrationCommit,
              integrationCommit,
            },
          },
          workspace: { path: "/tmp/combined-review", release() {} },
        };
      },
    });
    const card = fixture.reviewedCard();
    fixture.runtimeStore.saveReviewPackage(
      fixture.project.id,
      reviewPackage(card.id)
    );

    const response = await fixture.server.inject({
      method: "POST",
      url: `/api/queen-bee/${fixture.project.id}/cards/${card.id}/restart-review`,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(refreshedBase, "integration-2");
    assert.equal(response.json().card.reviewerLog.reviewPackageId, "package-2");
    assert.equal(
      response.json().card.workAttempts[0].reviewedIntegrationRevision,
      "integration-2"
    );
    assert.ok(
      fixture.runtimeStore.getReviewPackage(fixture.project.id, "package-2")
    );
  });

  it("retries the refreshed package when combined-state review fails", async () => {
    const fixture = createFixture({
      readinessState: "stale",
      reviewerError: true,
      refreshedReviewBuilder(
        card,
        _repoPath,
        _worktreePath,
        integrationCommit
      ) {
        const refreshed = reviewPackage(card.id);
        return {
          reviewPackage: {
            ...refreshed,
            id: "package-2",
            revisions: {
              ...refreshed.revisions,
              baseCommit: integrationCommit,
              integrationCommit,
            },
          },
          workspace: { path: "/tmp/combined-review", release() {} },
        };
      },
    });
    const card = fixture.reviewedCard();
    fixture.runtimeStore.saveReviewPackage(
      fixture.project.id,
      reviewPackage(card.id)
    );

    const response = await fixture.server.inject({
      method: "POST",
      url: `/api/queen-bee/${fixture.project.id}/cards/${card.id}/restart-review`,
    });

    assert.equal(response.statusCode, 502);
    const attempt = fixture.boardStore.getBoard(
      fixture.project.id,
      fixture.project.repoPath
    ).cards[0]?.workAttempts?.[0];
    assert.equal(attempt?.status, "review_error");
    assert.equal(attempt?.reviewPackageId, "package-2");
    assert.equal(attempt?.reviewedIntegrationRevision, "integration-2");
  });

  function createFixture(
    options: {
      readinessState?: ReviewReadiness["state"];
      refreshedReviewBuilder?: typeof buildRefreshedReviewPackage;
      reviewerError?: boolean;
    } = {}
  ) {
    const repoPath = mkdtempSync(join(tmpdir(), "hive-decisions-"));
    directories.push(repoPath);
    const project: ProjectListItem = {
      id: "project-1",
      name: "Project",
      repoPath,
      createdAt: "",
      systemPrompt: "",
      codingGuidelines: "",
      targetBranch: "main",
      maxConcurrentWorkers: 3,
    };
    const projectStore: ProjectStore = {
      getAll: () => [project],
      create: () => {
        throw new Error("Not used");
      },
      updateMaxConcurrentWorkers: () => project,
      unlink: () => {},
    };
    const runtimeStore = createQueenBeeRuntimeStore(join(repoPath, "runtime"));
    const boardStore = createBoardStore(() => {}, runtimeStore);
    const acceptedBranches: string[] = [];
    const discardedWorktrees: string[] = [];
    let reviewCalls = 0;
    const reviewer: Reviewer = {
      async review() {
        reviewCalls += 1;
        if (options.reviewerError) throw new Error("Reviewer unavailable");
        return {
          verdict: "approved",
          findings: [],
          verificationAssessment: {
            status: "sufficient",
            notes: "Verified",
          },
        };
      },
    };
    const integrationManager: IntegrationManager = {
      ensure: () => ({ branchName: "hive-main", revision: "integration-1" }),
      status: () => ({
        branchName: "hive-main",
        revision: "integration-1",
        targetBranch: "main",
        targetRevision: "target-1",
        state: "ready",
        ahead: 1,
        behind: 0,
        canIntegrate: true,
      }),
      integrate: () => ({
        branchName: "hive-main",
        revision: "integration-1",
        targetBranch: "main",
        targetRevision: "integration-1",
        state: "integrated",
        ahead: 0,
        behind: 0,
        canIntegrate: false,
      }),
      reviewReadiness: (input) => ({
        state: options.readinessState ?? "current",
        integrationRevision:
          options.readinessState === "stale"
            ? "integration-2"
            : input.reviewedIntegrationRevision,
        reviewedIntegrationRevision: input.reviewedIntegrationRevision,
        branchHead: input.reviewedHead,
        reviewedHead: input.reviewedHead,
        canAccept: options.readinessState !== "stale",
        canRefreshReview: options.readinessState === "stale",
        conflictingFiles: [],
        message: "Reviewed work is current with hive-main",
      }),
      assertCurrent: () => {},
      accept: (input) => {
        acceptedBranches.push(input.branchName);
        return { branchName: "hive-main", revision: "integration-2" };
      },
      discardWorktree: (_path, worktreePath) => {
        discardedWorktrees.push(worktreePath);
      },
      commitPlanningSnapshot: () => ({
        branchName: "hive-main",
        revision: "integration-2",
      }),
    };
    const server = Fastify();
    servers.push(server);
    registerWorkDecisionRoutes(server, {
      boardStore,
      projectStore,
      integrationManager,
      runtimeStore,
      reviewer,
      refreshedReviewBuilder: options.refreshedReviewBuilder,
    });

    return {
      server,
      project,
      boardStore,
      acceptedBranches,
      discardedWorktrees,
      runtimeStore,
      get reviewCalls() {
        return reviewCalls;
      },
      reviewedCard() {
        return boardStore.addCard(project.id, project.repoPath, {
          title: "Reviewed card",
          description: "Ready for a user decision",
          acceptanceCriteria: ["The user owns acceptance"],
          relevantFiles: ["source.ts"],
          dependencies: [],
          column: "reviewing",
          reviewerLog: {
            status: "complete",
            verdict: "approved",
            findings: [],
            verificationAssessment: {
              status: "sufficient",
              notes: "Verified",
            },
            reviewPackageId: "package-1",
            reviewedAt: "2026-07-19T00:00:00.000Z",
          },
          workAttempts: [
            {
              attempt: 1,
              branchName: "hive/card-1/attempt-1",
              worktreePath: "/tmp/card-1",
              baseCommit: "base-1",
              status: "reviewed",
              startedAt: "2026-07-19T00:00:00.000Z",
              reviewedHead: "head-1",
              reviewedIntegrationRevision: "integration-1",
              reviewPackageId: "package-1",
            },
          ],
        });
      },
    };
  }

  function reviewPackage(cardId: string): ReviewPackage {
    return {
      id: "package-1",
      card: {
        id: cardId,
        title: "Reviewed card",
        description: "Ready for a user decision",
        acceptanceCriteria: ["The user owns acceptance"],
        requirementRefs: [],
      },
      requirements: { revision: "requirements-1", content: "Requirements" },
      revisions: {
        baseCommit: "base-1",
        headCommit: "head-1",
        reviewCommit: "head-1",
        integrationCommit: "integration-1",
        cardRevision: "card-revision-1",
      },
      commits: [],
      changedFiles: [],
      diff: "",
      diffStat: "",
      verification: { commands: [] },
    };
  }
});
