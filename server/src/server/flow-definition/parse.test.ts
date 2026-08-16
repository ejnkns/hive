// The definition parser's ui.theme handling: the declarative theming tokens
// for the generic flow surfaces are a strictly whitelisted, validated block.
// A theme parses into the data definition; anything outside the whitelist
// (unknown keys, a non-hex accent, a multi-codepoint emblem — emoji are
// multi-codepoint and rejected) is an advisory finding, ignored.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDefinition } from "../flow-definition.ts";

// A minimal definition module whose ui.theme block is swapped per test.
function themedModule(theme: string): string {
  return `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "themedFlow",
  label: "Themed Flow",
  configSchema: [],
  ui: { theme: ${theme} },
  workflows: [
    {
      id: "items",
      label: "Items",
      instanceState: [],
      initial: "new",
      terminalStates: ["done"],
      states: [
        { id: "new", label: "New", category: "initial" },
        { id: "done", label: "Done", category: "terminal" },
      ],
    },
  ],
  edges: [],
};
`;
}

describe("parseDefinition ui.theme", () => {
  it("parses a valid theme (accent + emblem) into the data definition", () => {
    const { definition, findings } = parseDefinition(
      themedModule('{ accent: "#4a9fe0", emblem: "\u25b2" }')
    );
    assert.deepEqual(findings, []);
    assert.deepEqual(definition.ui?.theme, {
      accent: "#4a9fe0",
      emblem: "\u25b2",
    });
  });

  it("flags a bad accent hex and ignores it", () => {
    const { definition, findings } = parseDefinition(
      themedModule('{ accent: "not-a-color", emblem: "x" }')
    );
    assert.ok(
      findings.some(
        (f) => f.includes("flow.ui.theme.accent") && f.includes("#rrggbb")
      ),
      `expected an accent finding, got: ${findings.join("; ")}`
    );
    // The bad value is dropped; the valid emblem survives.
    assert.deepEqual(definition.ui?.theme, { emblem: "x" });
  });

  it("flags a multi-codepoint emblem (emoji) and ignores it", () => {
    const { definition, findings } = parseDefinition(
      themedModule('{ accent: "#4a9fe0", emblem: "AB" }')
    );
    assert.ok(
      findings.some(
        (f) =>
          f.includes("flow.ui.theme.emblem") && f.includes("single character")
      ),
      `expected an emblem finding, got: ${findings.join("; ")}`
    );
    assert.deepEqual(definition.ui?.theme, { accent: "#4a9fe0" });
  });

  it("flags an unknown theme key as an advisory (whitelist only)", () => {
    const { definition, findings } = parseDefinition(
      themedModule('{ accent: "#4a9fe0", layout: "magic" }')
    );
    assert.ok(
      findings.some(
        (f) => f.includes("flow.ui.theme") && f.includes('"layout"')
      ),
      `expected a whitelist finding, got: ${findings.join("; ")}`
    );
    // The representable part is still recovered.
    assert.deepEqual(definition.ui?.theme, { accent: "#4a9fe0" });
  });

  it("omits ui entirely when the theme block is empty", () => {
    const { definition, findings } = parseDefinition(themedModule("{}"));
    assert.deepEqual(findings, []);
    assert.equal(definition.ui, undefined);
  });
});
