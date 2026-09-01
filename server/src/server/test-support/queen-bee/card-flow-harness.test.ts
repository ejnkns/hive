// The card-flow harness drives real git repositories. A commit hook (or any
// outer git process) exports GIT_* context variables that the test process
// inherits. The hook's GIT_INDEX_FILE is RELATIVE ("​.git/index"), and inside
// a linked worktree `.git` is a file — so the engine's nested git operations
// die with "index file open failed: Not a directory" (the error that surfaced
// when the server suite first ran inside a pre-commit hook). The harness must
// scrub the inherited context so git behaves as it does in production.

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { cleanupCardRepo, setupCardRepo } from "./card-flow-harness.ts";

describe("card-flow harness git context", () => {
  // What `git commit` exports to its hooks (the topology vars that leak into
  // nested git invocations; GIT_INDEX_FILE is the one that actually breaks
  // worktree-nested commands).
  const injected: Array<[string, string]> = [
    ["GIT_INDEX_FILE", ".git/index"],
    ["GIT_DIR", ".git"],
    ["GIT_WORK_TREE", "."],
    ["GIT_OBJECT_DIRECTORY", ".git/objects"],
    ["GIT_COMMON_DIR", ".git"],
  ];

  after(() => {
    for (const [name] of injected) delete process.env[name];
  });

  it("setupCardRepo scrubs an inherited git hook context", () => {
    for (const [name, value] of injected) process.env[name] = value;
    const { root, basePath } = setupCardRepo();
    try {
      // The engine's worktree sequence: create a linked worktree, then run
      // git from inside it. With GIT_INDEX_FILE=.git/index inherited, the
      // in-worktree command opens <worktree>/.git/index — but .git is a FILE
      // there — and fails with "index file open failed: Not a directory".
      const worktree = join(root, "wt");
      execSync(`git worktree add "${worktree}" -b probe`, {
        cwd: basePath,
        encoding: "utf-8",
      });
      execSync("git status", { cwd: worktree, encoding: "utf-8" });
      assert.ok(true, "nested git operations must survive a hook context");
    } finally {
      cleanupCardRepo(root);
    }
  });
});
