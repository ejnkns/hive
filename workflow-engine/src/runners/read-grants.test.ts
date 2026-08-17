// The session read-grant: a user chat message that is itself a single
// path-like token grants the agent read access to that path for the session
// — even when it lies outside the task's workspace. The user types the path
// on its own (absolute, ~/-, ./- or ../-relative, or a bare directory
// reference like "effect/"); prose and multi-token messages grant nothing.

import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  grantedPathFromMessage,
  resolveGrantedRoots,
} from "../runners/read-grants.ts";

describe("grantedPathFromMessage", () => {
  it("accepts a single absolute path", () => {
    assert.equal(
      grantedPathFromMessage("/Users/ej/Code/effect"),
      "/Users/ej/Code/effect"
    );
    assert.equal(
      grantedPathFromMessage("/Users/ej/Code/effect/src/index.ts"),
      "/Users/ej/Code/effect/src/index.ts"
    );
  });

  it("accepts a bare directory reference (trailing slash)", () => {
    assert.equal(grantedPathFromMessage("effect/"), "effect");
    assert.equal(grantedPathFromMessage("./reference/"), "./reference");
    assert.equal(grantedPathFromMessage("../sibling/"), "../sibling");
  });

  it("rejects prose and multi-token messages", () => {
    assert.equal(grantedPathFromMessage("read the effect library"), undefined);
    assert.equal(
      grantedPathFromMessage("the source is at /Users/ej/Code/effect"),
      undefined
    );
    assert.equal(grantedPathFromMessage(""), undefined);
    assert.equal(grantedPathFromMessage("effect"), undefined);
  });
});

describe("resolveGrantedRoots", () => {
  it("resolves absolute, ~, and relative grants to absolute roots", () => {
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [
      { role: "user", content: "/abs/path" },
      { role: "user", content: "~/Code/effect" },
      { role: "user", content: "relative/" },
      { role: "assistant", content: "/ignored" },
      { role: "user", content: "just prose here" },
    ];
    const roots = resolveGrantedRoots(messages, "/base");
    assert.deepEqual(roots, [
      "/abs/path",
      join(homedir(), "Code/effect"),
      join("/base", "relative"),
    ]);
  });

  it("returns no roots without user-path messages", () => {
    const roots = resolveGrantedRoots(
      [
        { role: "user", content: "please continue" },
        { role: "assistant", content: "/nope" },
      ] as Array<{ role: "user" | "assistant"; content: string }>,
      "/base"
    );
    assert.deepEqual(roots, []);
  });
});
