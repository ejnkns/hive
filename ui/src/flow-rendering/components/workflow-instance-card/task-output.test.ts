import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { outcomeError, outcomeStatus, stringifyValue } from "./task-output.ts";

// Pure-function tests for the card's no-hint output readers. The card falls
// back to these for display fields and task outputs, so a malformed wire value
// must degrade to a readable string rather than a crash.

describe("stringifyValue", () => {
  it("keeps strings as-is and empties for nullish values", () => {
    assert.equal(stringifyValue("hello"), "hello");
    assert.equal(stringifyValue(null), "");
    assert.equal(stringifyValue(undefined), "");
  });

  it("joins an array of strings into readable comma-separated text", () => {
    assert.equal(
      stringifyValue(["a11y", "offline", "sync"]),
      "a11y, offline, sync"
    );
  });

  it("joins scalar arrays without quotes or brackets", () => {
    assert.equal(stringifyValue([1, 2, 3]), "1, 2, 3");
    assert.equal(stringifyValue([true, false]), "true, false");
    assert.equal(stringifyValue(["x", 2, false]), "x, 2, false");
  });

  it("renders an empty array as an empty string", () => {
    assert.equal(stringifyValue([]), "");
  });

  it("falls back to JSON for arrays containing objects", () => {
    const text = stringifyValue([{ name: "alpha" }, { name: "beta" }]);
    assert.match(text, /^\[/);
    assert.ok(text.includes('"name"'));
  });

  it("falls back to JSON for non-array non-string values", () => {
    assert.equal(
      stringifyValue({ tags: ["a"] }),
      '{\n  "tags": [\n    "a"\n  ]\n}'
    );
    assert.equal(stringifyValue(42), "42");
  });

  it("never throws on exotic values", () => {
    assert.equal(stringifyValue(Symbol("x")), "");
    assert.equal(
      stringifyValue(() => {}),
      ""
    );
  });
});

describe("outcome readers", () => {
  it("reads status and error from the outcome shape", () => {
    assert.equal(outcomeStatus({ status: "success" }), "success");
    assert.equal(outcomeStatus({}), "unknown");
    assert.equal(outcomeStatus(null), "unknown");
    assert.equal(outcomeError({ error: "boom" }), "boom");
    assert.equal(outcomeError({ error: "" }), null);
    assert.equal(outcomeError({ error: 42 }), null);
  });
});
