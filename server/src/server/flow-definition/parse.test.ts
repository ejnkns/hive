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

// A minimal definition module whose ui.components block is swapped per test.
function componentsModule(components: string): string {
  return `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "componentsFlow",
  label: "Components Flow",
  configSchema: [],
  ui: { components: ${components} },
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

describe("parseDefinition ui.components", () => {
  it("parses an inline source string as the legacy component form", () => {
    const { definition, findings } = parseDefinition(
      componentsModule(
        '{ "idea-card": "export default function (lit) { return {}; }" }'
      )
    );
    assert.deepEqual(findings, []);
    assert.deepEqual(definition.ui?.components, {
      "idea-card": "export default function (lit) { return {}; }",
    });
  });

  it("parses a ref-form component ({ ref }) into the data definition", () => {
    const { definition, findings } = parseDefinition(
      componentsModule('{ "ticket-card": { ref: "./ui/ticket-card.ts" } }')
    );
    assert.deepEqual(findings, []);
    assert.deepEqual(definition.ui?.components, {
      "ticket-card": { ref: "./ui/ticket-card.ts" },
    });
  });

  it("flags a non-data component value as an advisory and ignores it", () => {
    const { definition, findings } = parseDefinition(
      componentsModule(
        '{ "broken": 42, "ticket-card": { ref: "./ui/ticket-card.ts" } }'
      )
    );
    assert.ok(
      findings.some(
        (f) =>
          f.includes("flow.ui.components") &&
          f.includes('"broken"') &&
          f.includes("source string or a { ref }")
      ),
      `expected a component finding, got: ${findings.join("; ")}`
    );
    // The representable ref survives; the bad entry is dropped.
    assert.deepEqual(definition.ui?.components, {
      "ticket-card": { ref: "./ui/ticket-card.ts" },
    });
  });
});

describe("parseDefinition workflow ui", () => {
  it("parses ui.workflowComponent (the workflow-level custom view id)", () => {
    const { definition, findings } = parseDefinition(
      `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "wfUiFlow",
  label: "Wf Ui Flow",
  configSchema: [],
  workflows: [
    {
      id: "tickets",
      label: "Tickets",
      instanceState: [],
      initial: "new",
      terminalStates: ["done"],
      ui: {
        view: "board",
        instanceComponent: "ticket-card",
        workflowComponent: "frontier-board",
      },
      states: [
        { id: "new", label: "New", category: "initial" },
        { id: "done", label: "Done", category: "terminal" },
      ],
    },
  ],
  edges: [],
};
`
    );
    assert.deepEqual(findings, []);
    assert.deepEqual(definition.workflows[0]?.ui, {
      view: "board",
      instanceComponent: "ticket-card",
      workflowComponent: "frontier-board",
    });
  });
});
