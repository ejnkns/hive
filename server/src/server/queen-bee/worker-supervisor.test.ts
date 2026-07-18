import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

    await supervisor.run(card, repoPath, "", "", () => {});

    assert.match(receivedToolContent ?? "", /command complete/);
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

  function terminalResponse(content: string): DeviseModelResponse {
    return { content, toolCalls: [], finishReason: "stop" };
  }
});
