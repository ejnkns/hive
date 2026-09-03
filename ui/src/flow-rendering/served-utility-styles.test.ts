// The served-component utility-class stylesheet: the styling vocabulary the
// flow-authoring AI emits against. These tests pin the canonical class →
// token bindings (expected values are the token bindings, not recomputed
// from the stylesheet) and the invariants that keep the sheet teachable:
// token-backed (no raw color literals) and engine-generic (no wayfinder
// domain classes).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { servedUtilityStyles } from "./served-utility-styles.ts";

// The styling knowledge page the authoring session serves: the class list it
// teaches must be exactly the shipped stylesheet's (no drift in either
// direction). Located from this file, mirroring the knowledge loader's
// `<server root>/../skills/flow-authoring` resolution.
const STYLING_PAGE = join(
  import.meta.dirname,
  "../../../skills/flow-authoring/styling.md"
);

const CANONICAL_RULES: ReadonlyArray<{ className: string; rule: string }> = [
  { className: "flex", rule: "display: flex" },
  { className: "flex-col", rule: "flex-direction: column" },
  { className: "flex-1", rule: "flex: 1 1 0%" },
  { className: "items-center", rule: "align-items: center" },
  { className: "justify-between", rule: "justify-content: space-between" },
  { className: "gap-2", rule: "gap: var(--space-2)" },
  { className: "p-3", rule: "padding: var(--space-3)" },
  { className: "rounded-lg", rule: "border-radius: var(--radius-lg)" },
  { className: "text-muted", rule: "color: var(--muted)" },
  {
    className: "text-accent",
    rule: "color: var(--flow-accent, var(--accent))",
  },
  { className: "bg-surface", rule: "background: var(--surface)" },
  {
    className: "bg-accent",
    rule: "background: var(--flow-accent, var(--accent))",
  },
  { className: "border", rule: "border: 1px solid var(--border)" },
  { className: "wf-paper", rule: "background: var(--wf-paper)" },
  { className: "wf-ink", rule: "color: var(--wf-ink)" },
  { className: "min-h-0", rule: "min-height: 0" },
  { className: "overflow-y-auto", rule: "overflow-y: auto" },
  { className: "text-xs", rule: "font-size: var(--text-xs)" },
  { className: "uppercase", rule: "text-transform: uppercase" },
];

describe("servedUtilityStyles", () => {
  it("binds the canonical Tailwind-compatible classes to hive tokens", () => {
    for (const { className, rule } of CANONICAL_RULES) {
      const escaped = rule.replace(/[()[\]{}.$*+?|^\\]/g, "\\$&");
      assert.match(
        servedUtilityStyles.cssText,
        new RegExp(`\\.${className}\\s*{[^}]*${escaped}`),
        `.${className} must bind ${rule}`
      );
    }
  });

  it("is token-backed: no raw color literals outside var() arguments", () => {
    // Strip comments and var() arguments, then no hex/rgb color literals may
    // remain: the theme layer owns values, the utilities only bind tokens.
    const body = servedUtilityStyles.cssText.replace(/\/\*[\s\S]*?\*\//g, "");
    const withoutVars = body.replace(/var\([^)]*\)/g, "var(--stripped)");
    assert.doesNotMatch(withoutVars, /#[0-9a-fA-F]{3,8}\b/, "no hex literals");
    assert.doesNotMatch(
      withoutVars,
      /rgba?\(/,
      "no rgb()/rgba() literals outside var() arguments"
    );
  });

  it("stays engine-generic: no wayfinder-domain class names", () => {
    // The only wayfinder vocabulary allowed is the wf-* theme-token prefix
    // (wf-paper, wf-ink, wf-body, wf-paper-edge, wf-accent), never domain
    // words (station, pile, crate, fog, frontier...).
    const names = new Set<string>();
    for (const match of servedUtilityStyles.cssText.matchAll(
      /\.([a-z][a-z0-9-]*)\s*[,{]/g
    )) {
      names.add(match[1]);
    }
    assert.ok(names.size > 40, "the vocabulary must be substantive");
    for (const name of names) {
      assert.doesNotMatch(
        name,
        /^(station|pile|crate|fog|frontier|expedition|ticket|charting|depot|journal|briefing)/,
        `.${name} is wayfinder-domain vocabulary, not a utility`
      );
    }
  });

  describe("styling knowledge page", () => {
    // The class lists, extracted independently from each side.
    function shippedClassNames(): string[] {
      const names = new Set<string>();
      for (const match of servedUtilityStyles.cssText.matchAll(
        /\.([a-z][a-z0-9-]*)\s*[,{]/g
      )) {
        names.add(match[1]);
      }
      return [...names].sort();
    }

    // The page enumerates the vocabulary in fenced blocks — one bare class
    // name per line (the token binding is prose, not code). Code snippets in
    // other blocks never consist of exactly one bare name per line, so they
    // cannot leak into the list.
    function documentedClassNames(): string[] {
      const source = readFileSync(STYLING_PAGE, "utf-8");
      const names = new Set<string>();
      for (const block of source.matchAll(/```[\s\S]*?```/g)) {
        for (const line of block[0].split("\n")) {
          const name = line.trim().replace(/^\./, "");
          if (/^[a-z][a-z0-9-]*$/.test(name)) names.add(name);
        }
      }
      return [...names].sort();
    }

    it("exists and teaches the full shipped class list", () => {
      assert.deepEqual(documentedClassNames(), shippedClassNames());
    });

    it("names the tokens the classes bind to", () => {
      const source = readFileSync(STYLING_PAGE, "utf-8");
      for (const token of [
        "--space-2",
        "--radius-lg",
        "--text-xs",
        "--muted",
        "--wf-paper",
        "--flow-accent",
      ]) {
        assert.ok(
          source.includes(token),
          `the styling page must name ${token}`
        );
      }
    });
  });
});
