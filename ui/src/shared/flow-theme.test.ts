// The flow-theme application helper: a definition's declarative theme tokens
// → the scoped CSS-variable declarations for the generic flow surfaces. A
// valid accent produces all three flow vars; no theme (or a malformed hex)
// produces nothing, so pages fall back to the global accent unchanged.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { themeVars } from "./flow-theme.ts";

describe("themeVars", () => {
  it("produces the three flow vars from a valid accent", () => {
    const vars = themeVars({ accent: "#4a9fe0" });
    assert.match(vars, /--flow-accent: #4a9fe0;/);
    assert.match(vars, /--flow-accent-rgb: 74, 159, 224;/);
    assert.match(
      vars,
      /--flow-on-accent: color-mix\(in srgb, var\(--flow-accent\) 30%, var\(--text\)\);/
    );
  });

  it("derives the rgb from any hex, case-insensitively", () => {
    const vars = themeVars({ accent: "#F5B342" });
    assert.match(vars, /--flow-accent-rgb: 245, 179, 66;/);
  });

  it("returns no vars when the theme is absent", () => {
    assert.equal(themeVars(undefined), "");
    assert.equal(themeVars(null), "");
    assert.equal(themeVars({}), "");
  });

  it("returns no vars for a malformed accent", () => {
    assert.equal(themeVars({ accent: "blue" }), "");
    assert.equal(themeVars({ accent: "#4a9fe" }), "");
    assert.equal(themeVars({ accent: "#4a9fe0ff" }), "");
  });

  it("ignores the emblem for the var string (emblem is markup, not CSS)", () => {
    const vars = themeVars({ accent: "#4a9fe0", emblem: "\u25b2" });
    assert.match(vars, /--flow-accent: #4a9fe0;/);
    assert.doesNotMatch(vars, /emblem/);
  });
});
