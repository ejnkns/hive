import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { createBoardStore } from "./board-store";
import type { AgentModelCaller } from "./devise-engine/create-devise-model-caller";
import type { IntegrationManager } from "./integration-manager";
import { createPlanningManager } from "./planner";
import type { ProjectSpecificationStore } from "./project-specification-store";
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
      column: "ready",
    });
    const done = boardStore.addCard("project-1", repoPath, {
      title: "Accepted feature",
      description: "Immutable",
      acceptanceCriteria: ["Already accepted"],
      relevantFiles: ["source.ts"],
      dependencies: [],
      column: "done",
    });
    const planner = createPlanningManager(
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
    planner.decide("project-1", proposal.id, "change-2", "accepted");
    const cards = planner.apply("project-1", repoPath, proposal.id);

    assert.deepEqual(
      cards.map((card) => card.title),
      ["Revised idea", "Accepted feature", "Optional card"]
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
    const planner = createPlanningManager(
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
      column: "ready",
    });
    const planner = createPlanningManager(
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
      }),
      {
        apply() {
          throw new Error("Commit hook rejected");
        },
      } satisfies ProjectSpecificationStore
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

  it("rejects a proposal when the board changed after planning started", async () => {
    const repoPath = createWorkspace();
    const runtimeStore = createQueenBeeRuntimeStore(join(repoPath, ".runtime"));
    const boardStore = createBoardStore(() => {}, runtimeStore);
    const idea = boardStore.addCard("project-1", repoPath, {
      title: "Original card",
      description: "Original",
      acceptanceCriteria: ["Original behavior"],
      relevantFiles: ["source.ts"],
      dependencies: [],
      column: "ready",
    });
    const planner = createPlanningManager(
      boardStore,
      runtimeStore,
      integrationManager(),
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
    boardStore.addCard("project-1", repoPath, {
      title: "Concurrent idea",
      description: "Added later",
      acceptanceCriteria: ["Must be preserved"],
      relevantFiles: ["source.ts"],
      dependencies: [],
      column: "ready",
    });

    assert.throws(
      () => planner.apply("project-1", repoPath, proposal.id),
      /Board cards changed after planning started/
    );
    assert.equal(readRequirements(repoPath), "# Original requirements");
  });

  it("returns an Unfulfillable Card to Ready only after refinement approval", async () => {
    const repoPath = createWorkspace();
    const runtimeStore = createQueenBeeRuntimeStore(join(repoPath, ".runtime"));
    const boardStore = createBoardStore(() => {}, runtimeStore);
    const card = boardStore.addCard("project-1", repoPath, {
      title: "Refined idea",
      description: "Original",
      acceptanceCriteria: ["Original behavior"],
      relevantFiles: ["source.ts"],
      dependencies: [],
      column: "unfulfillable",
    });
    const planner = createPlanningManager(
      boardStore,
      runtimeStore,
      integrationManager(),
      responseCaller({
        changes: [
          {
            action: "update",
            cardId: card.id,
            rationale: "The user refined this idea",
            proposedCard: cardSpec("Approved refinement"),
          },
        ],
      })
    );

    const proposal = await planner.propose(
      "project-1",
      repoPath,
      "# Refined requirements",
      "Refine the selected idea",
      { cardId: card.id, target: "ready" }
    );
    assert.equal(
      boardStore.getBoard("project-1", repoPath).cards[0]?.column,
      "unfulfillable"
    );
    planner.decide("project-1", proposal.id, "change-0", "accepted");
    const cards = planner.apply("project-1", repoPath, proposal.id);

    assert.equal(cards[0]?.column, "ready");
  });

  it("refuses to apply requirements while a card change is rejected", async () => {
    const repoPath = createWorkspace();
    const runtimeStore = createQueenBeeRuntimeStore(join(repoPath, ".runtime"));
    const boardStore = createBoardStore(() => {}, runtimeStore);
    const idea = boardStore.addCard("project-1", repoPath, {
      title: "Original card",
      description: "Original",
      acceptanceCriteria: ["Original behavior"],
      relevantFiles: ["source.ts"],
      dependencies: [],
      column: "ready",
    });
    const planner = createPlanningManager(
      boardStore,
      runtimeStore,
      integrationManager(),
      responseCaller({
        changes: [
          {
            action: "update",
            cardId: idea.id,
            rationale: "The requirement changed",
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
    planner.decide("project-1", proposal.id, "change-0", "rejected");

    assert.throws(
      () => planner.apply("project-1", repoPath, proposal.id),
      /Rejected card changes require a revised/
    );
    assert.equal(readRequirements(repoPath), "# Original requirements");
  });

  it("archives remediated scope only through an accepted planning proposal", async () => {
    const repoPath = createWorkspace();
    const runtimeStore = createQueenBeeRuntimeStore(join(repoPath, ".runtime"));
    const boardStore = createBoardStore(() => {}, runtimeStore);
    const card = boardStore.addCard("project-1", repoPath, {
      title: "Abandoned card",
      description: "No longer required",
      acceptanceCriteria: ["Old behavior"],
      relevantFiles: ["source.ts"],
      dependencies: [],
      column: "unfulfillable",
    });
    const planner = createPlanningManager(
      boardStore,
      runtimeStore,
      integrationManager(),
      responseCaller({
        changes: [
          {
            action: "remove",
            cardId: card.id,
            rationale: "Scope moved to For later",
          },
        ],
      })
    );

    const proposal = await planner.propose(
      "project-1",
      repoPath,
      "# Requirements\n\n## For later\nOld behavior",
      "Archive the abandoned card",
      { cardId: card.id, target: "archived" }
    );
    assert.equal(boardStore.getBoard("project-1", repoPath).cards.length, 1);
    planner.decide("project-1", proposal.id, "change-0", "accepted");
    const cards = planner.apply("project-1", repoPath, proposal.id);

    assert.deepEqual(cards, []);
    assert.deepEqual(boardStore.getBoard("project-1", repoPath).cards, []);
  });

  it("creates initial planned Cards directly in Ready", async () => {
    const repoPath = createWorkspace();
    const runtimeStore = createQueenBeeRuntimeStore(join(repoPath, ".runtime"));
    const boardStore = createBoardStore(() => {}, runtimeStore);
    const planner = createPlanningManager(
      boardStore,
      runtimeStore,
      integrationManager(),
      responseCaller({
        changes: [
          {
            action: "create",
            rationale: "Initial requirement",
            proposedCard: cardSpec("Initial Card"),
          },
        ],
      })
    );

    const proposal = await planner.propose(
      "project-1",
      repoPath,
      "# Initial requirements"
    );
    assert.equal("kind" in proposal, false);
    if ("kind" in proposal) assert.fail("Expected a Planning Proposal");
    assert.equal(proposal.runKind, "initial_planning");
    const cards = planner.acceptAll("project-1", repoPath, proposal.id);
    assert.equal(cards[0]?.column, "ready");
  });

  it("rejects an initial plan that creates no executable Cards", async () => {
    const repoPath = createWorkspace();
    const runtimeStore = createQueenBeeRuntimeStore(join(repoPath, ".runtime"));
    const planner = createPlanningManager(
      createBoardStore(() => {}, runtimeStore),
      runtimeStore,
      integrationManager(),
      responseCaller({ changes: [] })
    );

    await assert.rejects(
      () => planner.propose("project-1", repoPath, "# Initial requirements"),
      /at least one Ready Card/
    );
  });

  it("maps created-change dependencies to generated Card IDs", async () => {
    const repoPath = createWorkspace();
    const runtimeStore = createQueenBeeRuntimeStore(join(repoPath, ".runtime"));
    const planner = createPlanningManager(
      createBoardStore(() => {}, runtimeStore),
      runtimeStore,
      integrationManager(),
      responseCaller({
        changes: [
          {
            action: "create",
            rationale: "Foundation",
            proposedCard: cardSpec("Foundation"),
          },
          {
            action: "create",
            rationale: "Depends on the foundation",
            proposedCard: {
              ...cardSpec("Dependent"),
              dependencies: ["change-0"],
            },
          },
        ],
      })
    );

    const outcome = await planner.propose(
      "project-1",
      repoPath,
      "# Initial requirements"
    );
    if ("kind" in outcome) assert.fail("Expected a Planning Proposal");
    const cards = planner.acceptAll("project-1", repoPath, outcome.id);

    assert.deepEqual(cards[1]?.dependencies, [cards[0]?.id]);
  });

  it("rejects duplicate reconciliation and cyclic dependencies", async () => {
    const repoPath = createWorkspace();
    const runtimeStore = createQueenBeeRuntimeStore(join(repoPath, ".runtime"));
    const boardStore = createBoardStore(() => {}, runtimeStore);
    const card = boardStore.addCard("project-1", repoPath, {
      title: "Existing",
      description: "Existing work",
      acceptanceCriteria: ["It works"],
      relevantFiles: ["source.ts"],
      dependencies: [],
      column: "ready",
    });
    const duplicatePlanner = createPlanningManager(
      boardStore,
      runtimeStore,
      integrationManager(),
      responseCaller({
        changes: [
          { action: "keep", cardId: card.id, rationale: "Keep it" },
          { action: "keep", cardId: card.id, rationale: "Keep it again" },
        ],
      })
    );
    await assert.rejects(
      () => duplicatePlanner.propose("project-1", repoPath, "# Proposed"),
      /exactly once/
    );

    const cycleWorkspace = createWorkspace();
    const cycleRuntime = createQueenBeeRuntimeStore(
      join(cycleWorkspace, ".runtime")
    );
    const cyclePlanner = createPlanningManager(
      createBoardStore(() => {}, cycleRuntime),
      cycleRuntime,
      integrationManager(),
      responseCaller({
        changes: [
          {
            action: "create",
            rationale: "First",
            proposedCard: {
              ...cardSpec("First"),
              dependencies: ["change-1"],
            },
          },
          {
            action: "create",
            rationale: "Second",
            proposedCard: {
              ...cardSpec("Second"),
              dependencies: ["change-0"],
            },
          },
        ],
      })
    );
    await assert.rejects(
      () => cyclePlanner.propose("project-1", cycleWorkspace, "# Initial"),
      /form a DAG/
    );
  });

  it("archives a resolved Idea and records lineage on its Ready Cards", async () => {
    const repoPath = createWorkspace();
    const runtimeStore = createQueenBeeRuntimeStore(join(repoPath, ".runtime"));
    const boardStore = createBoardStore(() => {}, runtimeStore);
    const idea = boardStore.addIdea("project-1", repoPath, {
      title: "Dark mode",
      brief: "Support a dark appearance",
    });
    const planner = createPlanningManager(
      boardStore,
      runtimeStore,
      integrationManager(),
      responseCaller({
        changes: [
          {
            action: "create",
            rationale: "The Idea requires implementation",
            resolvesSourceIdea: true,
            proposedCard: cardSpec("Dark mode"),
          },
        ],
      })
    );

    const proposal = await planner.propose(
      "project-1",
      repoPath,
      "# Requirements\n\nDark mode",
      undefined,
      { ideaId: idea.id, target: "resolved" }
    );
    const cards = planner.acceptAll("project-1", repoPath, proposal.id);
    assert.equal(boardStore.getBoard("project-1", repoPath).ideas.length, 0);
    assert.deepEqual(cards[0]?.originIdeaIds, [idea.id]);
    assert.equal(cards[0]?.column, "ready");
  });

  it("requires explicit acceptance when an Idea links to an existing Card", async () => {
    const repoPath = createWorkspace();
    const runtimeStore = createQueenBeeRuntimeStore(join(repoPath, ".runtime"));
    const boardStore = createBoardStore(() => {}, runtimeStore);
    const idea = boardStore.addIdea("project-1", repoPath, {
      title: "Existing support",
      brief: "Capture behavior already represented by a Card",
    });
    const card = boardStore.addCard("project-1", repoPath, {
      title: "Existing Card",
      description: "Already covers the Idea",
      acceptanceCriteria: ["The behavior works"],
      relevantFiles: ["source.ts"],
      dependencies: [],
      column: "ready",
    });
    const planner = createPlanningManager(
      boardStore,
      runtimeStore,
      integrationManager(),
      responseCaller({
        changes: [
          {
            action: "keep",
            cardId: card.id,
            rationale: "The existing Card already represents this Idea",
            resolvesSourceIdea: true,
          },
        ],
      })
    );

    const outcome = await planner.propose(
      "project-1",
      repoPath,
      "# Requirements\n\nExisting support",
      undefined,
      { ideaId: idea.id, target: "resolved" }
    );
    assert.equal("kind" in outcome, false);
    if ("kind" in outcome) assert.fail("Expected a Planning Proposal");
    assert.equal(outcome.changes[0]?.decision, "pending");

    planner.decide("project-1", outcome.id, "change-0", "accepted");
    const cards = planner.apply("project-1", repoPath, outcome.id);
    assert.deepEqual(cards[0]?.originIdeaIds, [idea.id]);
  });

  it("persists Requirements Feedback instead of creating a partial proposal", async () => {
    const repoPath = createWorkspace();
    const runtimeStore = createQueenBeeRuntimeStore(join(repoPath, ".runtime"));
    const boardStore = createBoardStore(() => {}, runtimeStore);
    const planner = createPlanningManager(
      boardStore,
      runtimeStore,
      integrationManager(),
      responseCaller({
        requirementsFeedback: [
          {
            requirementRefs: ["FR-1"],
            category: "missing_decision",
            explanation: "The authentication method is unspecified.",
            evidence: ["FR-1 requires login"],
            decisionNeeded: "Choose password or passkey authentication.",
            recommendation: "Prefer passkeys with a password fallback.",
          },
        ],
      })
    );

    const outcome = await planner.propose(
      "project-1",
      repoPath,
      "# Proposed requirements"
    );

    assert.equal("kind" in outcome, true);
    if (!("kind" in outcome)) assert.fail("Expected Requirements Feedback");
    assert.equal(outcome.issues[0]?.category, "missing_decision");
    assert.deepEqual(
      planner.getRequirementsFeedback("project-1", outcome.id),
      outcome
    );
  });

  it("preserves provider reasoning across Planner tool-call turns", async () => {
    const repoPath = createWorkspace();
    const runtimeStore = createQueenBeeRuntimeStore(join(repoPath, ".runtime"));
    let callCount = 0;
    const planner = createPlanningManager(
      createBoardStore(() => {}, runtimeStore),
      runtimeStore,
      integrationManager(),
      {
        async call(messages) {
          callCount += 1;
          if (callCount === 1) {
            return {
              content: "Inspecting the current requirements.",
              reasoningContent: "provider thinking payload",
              reasoning: "provider reasoning payload",
              toolCalls: [
                {
                  id: "read-requirements",
                  name: "read_file",
                  arguments: JSON.stringify({
                    path: ".hive/requirements.md",
                  }),
                },
                {
                  id: "list-project",
                  name: "list_directory",
                  arguments: JSON.stringify({ path: "." }),
                },
              ],
              finishReason: "tool_calls",
            };
          }

          const toolTurn = messages.find(
            (message) =>
              message.role === "assistant" &&
              message.reasoning_content === "provider thinking payload"
          );
          assert.equal(
            toolTurn?.reasoning_content,
            "provider thinking payload"
          );
          assert.equal(toolTurn?.reasoning, "provider reasoning payload");
          assert.ok(Array.isArray(toolTurn?.tool_calls));
          assert.equal(toolTurn.tool_calls.length, 2);
          assert.equal(
            messages.filter((message) => message.role === "assistant").length,
            1
          );
          assert.equal(
            messages.filter((message) => message.role === "tool").length,
            2
          );
          return {
            content: `\`\`\`json\n${JSON.stringify({
              changes: [
                {
                  action: "create",
                  rationale: "Implement the initial requirements",
                  proposedCard: cardSpec("Initial Card"),
                },
              ],
            })}\n\`\`\``,
            toolCalls: [],
            finishReason: "stop",
          };
        },
      }
    );

    await planner.propose("project-1", repoPath, "# Proposed requirements");
    assert.equal(callCount, 2);
  });

  it("rejects Planner output that mixes feedback with Card changes", async () => {
    const repoPath = createWorkspace();
    const runtimeStore = createQueenBeeRuntimeStore(join(repoPath, ".runtime"));
    const planner = createPlanningManager(
      createBoardStore(() => {}, runtimeStore),
      runtimeStore,
      integrationManager(),
      responseCaller({
        requirementsFeedback: [
          {
            requirementRefs: [],
            category: "insufficient_detail",
            explanation: "The behavior is unclear.",
            evidence: [],
            decisionNeeded: "Clarify the behavior.",
            recommendation: "Add an observable outcome.",
          },
        ],
        changes: [],
      })
    );

    await assert.rejects(
      () => planner.propose("project-1", repoPath, "# Proposed"),
      /either Requirements Feedback or Card changes/
    );
  });

  it("rejects Idea lineage that points only to a removed Card", async () => {
    const repoPath = createWorkspace();
    const runtimeStore = createQueenBeeRuntimeStore(join(repoPath, ".runtime"));
    const boardStore = createBoardStore(() => {}, runtimeStore);
    const idea = boardStore.addIdea("project-1", repoPath, {
      title: "Audit existing support",
      brief: "Verify an existing feature",
    });
    const card = boardStore.addCard("project-1", repoPath, {
      title: "Old work",
      description: "No longer useful",
      acceptanceCriteria: ["Old behavior"],
      relevantFiles: ["source.ts"],
      dependencies: [],
      column: "ready",
    });
    const planner = createPlanningManager(
      boardStore,
      runtimeStore,
      integrationManager(),
      responseCaller({
        changes: [
          {
            action: "remove",
            cardId: card.id,
            rationale: "Remove old work",
            resolvesSourceIdea: true,
          },
        ],
      })
    );

    await assert.rejects(
      () =>
        planner.propose("project-1", repoPath, "# Proposed", undefined, {
          ideaId: idea.id,
          target: "resolved",
        }),
      /surviving Card/
    );
  });

  it("requires a new Ready verification Card instead of resolving an Idea to Done", async () => {
    const repoPath = createWorkspace();
    const runtimeStore = createQueenBeeRuntimeStore(join(repoPath, ".runtime"));
    const boardStore = createBoardStore(() => {}, runtimeStore);
    const idea = boardStore.addIdea("project-1", repoPath, {
      title: "Verify existing feature",
      brief: "Confirm behavior already present in the codebase",
    });
    const done = boardStore.addCard("project-1", repoPath, {
      title: "Historical implementation",
      description: "Already accepted work",
      acceptanceCriteria: ["The feature exists"],
      relevantFiles: ["source.ts"],
      dependencies: [],
      column: "done",
    });
    const planner = createPlanningManager(
      boardStore,
      runtimeStore,
      integrationManager(),
      responseCaller({
        changes: [
          {
            action: "keep",
            cardId: done.id,
            rationale: "Use historical work",
            resolvesSourceIdea: true,
          },
        ],
      })
    );

    await assert.rejects(
      () =>
        planner.propose("project-1", repoPath, "# Proposed", undefined, {
          ideaId: idea.id,
          target: "resolved",
        }),
      /Ready Card/
    );
  });

  function createWorkspace(): string {
    const repoPath = mkdtempSync(join(tmpdir(), "hive-planner-"));
    directories.push(repoPath);
    writeRequirements(repoPath, "# Original requirements");
    git(repoPath, ["init", "-b", "main"]);
    git(repoPath, ["config", "user.name", "Hive Test"]);
    git(repoPath, ["config", "user.email", "hive@example.test"]);
    git(repoPath, ["add", ".hive/requirements.md"]);
    git(repoPath, ["commit", "-m", "source: initialize requirements"]);
    return repoPath;
  }

  function git(repoPath: string, args: string[]): string {
    return execFileSync("git", args, {
      cwd: repoPath,
      encoding: "utf-8",
    }).trim();
  }

  function responseCaller(output: unknown): AgentModelCaller {
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
      reviewReadiness: () => {
        throw new Error("Not used");
      },
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
