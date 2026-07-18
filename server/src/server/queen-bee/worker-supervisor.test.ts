import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
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
import type { Coordinator } from "./coordinator";
import type {
  DeviseModelCaller,
  DeviseModelResponse,
} from "./devise-engine/create-devise-model-caller";
import type { Reviewer } from "./reviewer";
import { createWorkerSupervisor } from "./worker-supervisor";

describe("WorkerSupervisor", () => {
  const repositories: string[] = [];

  afterEach(() => {
    for (const repository of repositories.splice(0)) {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  it("includes completed command output in the next model turn", async () => {
    const repoPath = createGitRepository();
    const boardStore = createBoardStore(() => {});
    const card = boardStore.addCard("project-1", repoPath, {
      title: "Run a verification command",
      description: "Verify the worker command contract",
      acceptanceCriteria: ["The command output reaches the model"],
      relevantFiles: ["source.txt"],
      dependencies: [],
      column: "ready",
    });
    let callCount = 0;
    let receivedToolContent: string | undefined;

    const modelCaller: DeviseModelCaller = {
      async call(messages): Promise<DeviseModelResponse> {
        callCount += 1;
        if (callCount === 1) {
          return {
            content: "I will run the verification command.",
            toolCalls: [
              {
                id: "command-1",
                name: "run_command",
                arguments: JSON.stringify({
                  command: process.execPath,
                  args: ["-e", 'process.stdout.write("command complete")'],
                }),
              },
            ],
            finishReason: "tool_calls",
          };
        }
        if (callCount === 2) {
          receivedToolContent = messages.find(
            (message) => message.role === "tool"
          )?.content;
          return terminalResponse("Implementation complete");
        }
        return terminalResponse("Verified the worker command contract");
      },
    };
    const reviewer: Reviewer = {
      async review() {
        return { verdict: "pass", feedback: "Command contract verified" };
      },
    };
    const coordinator: Coordinator = {
      async analyze() {
        return { summary: "Not used", suggestions: [] };
      },
    };
    const supervisor = createWorkerSupervisor(
      boardStore,
      reviewer,
      coordinator,
      modelCaller
    );

    await supervisor.run("project-1", card, repoPath, "", "", () => {});

    assert.match(receivedToolContent ?? "", /command complete/);
  });

  it("reuses interrupted work from the card's existing worktree", async () => {
    const repoPath = createGitRepository();
    const boardStore = createBoardStore(() => {});
    const card = boardStore.addCard("project-1", repoPath, {
      title: "Resume interrupted work",
      description: "Keep the worker's existing changes",
      acceptanceCriteria: ["The interrupted change is preserved"],
      relevantFiles: ["source.txt"],
      dependencies: [],
      column: "in_progress",
    });
    const worktreePath = createCardWorktree(repoPath, card.id);
    writeFileSync(join(worktreePath, "source.txt"), "interrupted change\n");
    let observedSource = "";
    let callCount = 0;
    const modelCaller: DeviseModelCaller = {
      async call(_messages, workspacePath) {
        callCount += 1;
        if (callCount === 1) {
          observedSource = readFileSync(
            join(workspacePath, "source.txt"),
            "utf-8"
          );
          return terminalResponse("Implementation complete");
        }
        return terminalResponse("Preserved interrupted work");
      },
    };
    const supervisor = createWorkerSupervisor(
      boardStore,
      failingReviewer(),
      unusedCoordinator(),
      modelCaller
    );

    await supervisor.run("project-1", card, repoPath, "", "", () => {});

    assert.equal(observedSource, "interrupted change\n");
  });

  it("blocks an unrelated existing card branch without modifying it", async () => {
    const repoPath = createGitRepository();
    const boardStore = createBoardStore(() => {});
    const card = boardStore.addCard("project-1", repoPath, {
      title: "Reject unrelated history",
      description: "Do not overwrite an unrelated branch",
      acceptanceCriteria: ["The existing worktree remains untouched"],
      relevantFiles: ["source.txt"],
      dependencies: [],
      column: "in_progress",
    });
    const worktreePath = createUnrelatedCardWorktree(repoPath, card.id);
    const sentinelPath = join(worktreePath, "sentinel.txt");
    writeFileSync(sentinelPath, "do not remove\n", "utf-8");
    const originalHead = git(repoPath, ["rev-parse", `qb/${card.id}`]);
    let modelCallCount = 0;
    const modelCaller: DeviseModelCaller = {
      async call() {
        modelCallCount += 1;
        return terminalResponse("This should not run");
      },
    };
    const supervisor = createWorkerSupervisor(
      boardStore,
      failingReviewer(),
      unusedCoordinator(),
      modelCaller
    );

    await supervisor.run("project-1", card, repoPath, "", "", () => {});

    assert.equal(modelCallCount, 0);
    assert.equal(git(repoPath, ["rev-parse", `qb/${card.id}`]), originalHead);
    assert.equal(readFileSync(sentinelPath, "utf-8"), "do not remove\n");
    assert.equal(
      boardStore.getBoard("project-1", repoPath).cards[0]?.column,
      "ready"
    );
  });

  it("blocks a card branch created from a stale project revision", async () => {
    const repoPath = createGitRepository();
    const boardStore = createBoardStore(() => {});
    const card = boardStore.addCard("project-1", repoPath, {
      title: "Reject stale history",
      description: "Do not resume from an outdated project revision",
      acceptanceCriteria: ["The stale worktree remains untouched"],
      relevantFiles: ["source.txt"],
      dependencies: [],
      column: "in_progress",
    });
    const worktreePath = createCardWorktree(repoPath, card.id);
    const sentinelPath = join(worktreePath, "sentinel.txt");
    writeFileSync(sentinelPath, "preserve stale work\n", "utf-8");
    writeFileSync(join(repoPath, "main-only.txt"), "new project revision\n");
    git(repoPath, ["add", "main-only.txt"]);
    git(repoPath, ["commit", "--quiet", "-m", "advance project"]);
    const originalBranchHead = git(repoPath, ["rev-parse", `qb/${card.id}`]);
    let modelCallCount = 0;
    const supervisor = createWorkerSupervisor(
      boardStore,
      failingReviewer(),
      unusedCoordinator(),
      {
        async call() {
          modelCallCount += 1;
          return terminalResponse("This should not run");
        },
      }
    );

    await supervisor.run("project-1", card, repoPath, "", "", () => {});

    assert.equal(modelCallCount, 0);
    assert.equal(
      git(repoPath, ["rev-parse", `qb/${card.id}`]),
      originalBranchHead
    );
    assert.equal(readFileSync(sentinelPath, "utf-8"), "preserve stale work\n");
  });

  it("persists project-scoped progress before the worker finishes", async () => {
    const repoPath = createGitRepository();
    const boardStore = createBoardStore(() => {});
    const card = boardStore.addCard("project-1", repoPath, {
      title: "Persist worker progress",
      description: "Keep enough state to diagnose an interruption",
      acceptanceCriteria: ["Progress is saved during the run"],
      relevantFiles: ["source.txt"],
      dependencies: [],
      column: "ready",
    });
    let notifySecondCall = () => {};
    let interruptSecondCall = (_error: Error) => {};
    const secondCallStarted = new Promise<void>((resolve) => {
      notifySecondCall = resolve;
    });
    const interruptedCall = new Promise<never>((_resolve, reject) => {
      interruptSecondCall = reject;
    });
    let callCount = 0;
    const modelCaller: DeviseModelCaller = {
      async call() {
        callCount += 1;
        if (callCount === 1) {
          return {
            content: "Starting verification",
            toolCalls: [
              {
                id: "command-1",
                name: "run_command",
                arguments: JSON.stringify({
                  command: process.execPath,
                  args: ["-e", 'process.stdout.write("verified")'],
                }),
              },
            ],
            finishReason: "tool_calls",
          };
        }
        notifySecondCall();
        return await interruptedCall;
      },
    };
    const supervisor = createWorkerSupervisor(
      boardStore,
      failingReviewer(),
      unusedCoordinator(),
      modelCaller
    );
    const run = supervisor.run("project-1", card, repoPath, "", "", () => {});

    await secondCallStarted;
    try {
      const savedBoard = JSON.parse(
        readFileSync(join(repoPath, ".hive", "board.json"), "utf-8")
      ) as {
        projectId: string;
        cards: Array<{
          workerLog?: {
            iterations: number;
            content: string;
            toolCalls: Array<{ name: string }>;
          };
        }>;
      };
      assert.equal(savedBoard.projectId, "project-1");
      assert.equal(savedBoard.cards[0]?.workerLog?.iterations, 2);
      assert.match(savedBoard.cards[0]?.workerLog?.content ?? "", /Starting/);
      assert.deepEqual(
        savedBoard.cards[0]?.workerLog?.toolCalls.map((call) => call.name),
        ["run_command"]
      );
    } finally {
      interruptSecondCall(new Error("Simulated process interruption"));
      await run;
    }
  });

  function createGitRepository(): string {
    const repoPath = mkdtempSync(join(tmpdir(), "hive-worker-supervisor-"));
    repositories.push(repoPath);
    execFileSync("git", ["init", "--quiet"], { cwd: repoPath });
    execFileSync("git", ["config", "user.name", "Hive Test"], {
      cwd: repoPath,
    });
    execFileSync("git", ["config", "user.email", "hive@example.test"], {
      cwd: repoPath,
    });
    writeFileSync(join(repoPath, "source.txt"), "initial\n", "utf-8");
    execFileSync("git", ["add", "source.txt"], { cwd: repoPath });
    execFileSync("git", ["commit", "--quiet", "-m", "initial"], {
      cwd: repoPath,
    });
    return repoPath;
  }

  function createCardWorktree(repoPath: string, cardId: string): string {
    const worktreePath = join(repoPath, ".worktrees", cardId);
    mkdirSync(join(repoPath, ".worktrees"), { recursive: true });
    git(repoPath, [
      "worktree",
      "add",
      "--quiet",
      "-b",
      `qb/${cardId}`,
      worktreePath,
    ]);
    return worktreePath;
  }

  function createUnrelatedCardWorktree(
    repoPath: string,
    cardId: string
  ): string {
    const worktreePath = join(repoPath, ".worktrees", cardId);
    mkdirSync(join(repoPath, ".worktrees"), { recursive: true });
    git(repoPath, ["worktree", "add", "--quiet", "--detach", worktreePath]);
    git(worktreePath, ["checkout", "--quiet", "--orphan", `qb/${cardId}`]);
    if (existsSync(join(worktreePath, "source.txt"))) {
      git(worktreePath, ["rm", "--quiet", "--force", "source.txt"]);
    }
    writeFileSync(join(worktreePath, "source.txt"), "unrelated history\n");
    git(worktreePath, ["add", "source.txt"]);
    git(worktreePath, ["commit", "--quiet", "-m", "unrelated root"]);
    return worktreePath;
  }

  function git(repoPath: string, args: string[]): string {
    return execFileSync("git", args, {
      cwd: repoPath,
      encoding: "utf-8",
    }).trim();
  }

  function failingReviewer(): Reviewer {
    return {
      async review() {
        return { verdict: "fail", feedback: "Keep the worktree" };
      },
    };
  }

  function unusedCoordinator(): Coordinator {
    return {
      async analyze() {
        return { summary: "Not used", suggestions: [] };
      },
    };
  }

  function terminalResponse(content: string): DeviseModelResponse {
    return { content, toolCalls: [], finishReason: "stop" };
  }
});
