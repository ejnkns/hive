import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolvePath } from "./resolve-path";

describe("resolvePath", () => {
  it("resolves a dotted path into a nested object", () => {
    const value = { cardSpec: { title: "Implement X", bullets: ["a"] } };
    assert.equal(resolvePath(value, "cardSpec.title"), "Implement X");
  });

  it("resolves the empty string to the root", () => {
    const value = { a: 1 };
    assert.equal(resolvePath(value, ""), value);
  });

  it("returns undefined for a missing segment", () => {
    const value = { cardSpec: { title: "X" } };
    assert.equal(resolvePath(value, "cardSpec.nope"), undefined);
    assert.equal(resolvePath(value, "missing.title"), undefined);
  });

  it("returns undefined when a segment is a primitive", () => {
    const value = { cardSpec: "plain string" };
    assert.equal(resolvePath(value, "cardSpec.title"), undefined);
  });
});
