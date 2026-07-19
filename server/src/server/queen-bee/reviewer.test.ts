import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type {
  AgentModelCaller,
  AgentModelResponse,
} from "./devise-engine/create-devise-model-caller";
import { createReviewer, REVIEWER_TOOLS, type ReviewPackage } from "./reviewer";

describe("Reviewer Agent", () => {
  const workspaces: string[] = [];

  afterEach(() => {
    for (const workspace of workspaces.splice(0)) {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("uses read-only inspection before structured review submission", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "hive-reviewer-"));
    workspaces.push(workspacePath);
    writeFileSync(
      join(workspacePath, "source.ts"),
      "export const value = 2;\n"
    );
    let calls = 0;
    let inspectedContent = "";
    const modelCaller: AgentModelCaller = {
      async call(messages): Promise<AgentModelResponse> {
        calls += 1;
        if (calls === 1) {
          return toolResponse("read-1", "read_file", { path: "source.ts" });
        }
        inspectedContent = messages.at(-1)?.content ?? "";
        return toolResponse("review-1", "submit_review", {
          verdict: "approved",
          findings: [],
          verificationAssessment: {
            status: "sufficient",
            notes: "The recorded check covers the change.",
          },
        });
      },
    };
    const reviewer = createReviewer(modelCaller);

    const result = await reviewer.review(reviewPackage(), workspacePath);

    assert.match(inspectedContent, /export const value = 2/);
    assert.equal(result.verdict, "approved");
    assert.deepEqual(result.findings, []);
    assert.equal(result.verificationAssessment.status, "sufficient");
  });

  it("does not expose write, command, commit, or requirements tools", () => {
    const names = REVIEWER_TOOLS.map((tool) => tool.function.name);

    assert.equal(names.includes("read_file"), true);
    assert.equal(names.includes("search_code"), true);
    assert.equal(names.includes("git_show"), true);
    assert.equal(names.includes("submit_review"), true);
    assert.equal(names.includes("write_file"), false);
    assert.equal(names.includes("run_command"), false);
    assert.equal(names.includes("commit_work"), false);
    assert.equal(names.includes("update_requirements_draft"), false);
  });

  function reviewPackage(): ReviewPackage {
    return {
      id: "review-package-1",
      card: {
        id: "card-1",
        title: "Change value",
        description: "Change the exported value",
        acceptanceCriteria: ["value equals 2"],
        requirementRefs: ["FR-1"],
      },
      requirements: {
        revision: "requirements-1",
        content: "[FR-1] value equals 2",
      },
      revisions: {
        baseCommit: "base-commit",
        headCommit: "head-commit",
        reviewCommit: "head-commit",
        integrationCommit: "base-commit",
        cardRevision: "card-revision",
      },
      commits: [{ sha: "head-commit", subject: "worker: change value" }],
      changedFiles: ["source.ts"],
      diff: "+export const value = 2;",
      diffStat: "source.ts | 1 +",
      verification: {
        commands: [
          {
            callId: "verify-1",
            command: "pnpm test",
            output: "passed",
            headCommit: "head-commit",
          },
        ],
      },
    };
  }

  function toolResponse(
    id: string,
    name: string,
    args: object
  ): AgentModelResponse {
    return {
      content: "",
      toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
      finishReason: "tool_calls",
    };
  }
});
