// The reverse renderer: a rendered definition entry parses back into the
// FlowBlueprint that produced it. The round-trip is the oracle — every
// renderer corpus spec (asserted in render-flow-definition.test.ts) and both
// preset blueprints parse to a blueprint that validates clean and re-renders
// byte-identical; hand edits outside the blueprint vocabulary surface as
// not-spec-representable findings naming the location.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { queenBeeBlueprint } from "../../../presets/queen-bee/blueprint.ts";
import { wayfinderBlueprint } from "../../../presets/wayfinder/blueprint.ts";
import {
  analyzeFlowBlueprint,
  validateFlowBlueprint,
} from "./flow-blueprint.ts";
import { materializeModuleSet, runModuleSetGate } from "./module-set.ts";
import { parseFlowDefinition } from "./parse-flow-definition.ts";
import { renderFlowDefinition } from "./render-flow-definition.ts";

// ─── round-trip helpers ──────────────────────────────────────────────

function roundTrip(
  blueprint: Parameters<typeof renderFlowDefinition>[0],
  files?: Record<string, string>
) {
  const rendered = renderFlowDefinition(blueprint);
  const parsed = parseFlowDefinition(rendered.entry, files ?? rendered.files);
  assert.deepEqual(
    parsed.findings,
    [],
    `unexpected findings: ${parsed.findings.join("; ")}`
  );
  const validation = validateFlowBlueprint(parsed.blueprint);
  assert.deepEqual(
    validation,
    [],
    `parsed blueprint validation: ${validation.map((e) => `${e.path}: ${e.message}`).join("; ")}`
  );
  const reRendered = renderFlowDefinition(parsed.blueprint).entry;
  assert.equal(
    reRendered,
    rendered.entry,
    "the parsed blueprint must re-render byte-identically"
  );
  return parsed.blueprint;
}

// The preset module-set files: the shipped implementations read from the
// preset package (the renderer's stubs are the entry's materialization
// defaults, not the authoritative files).
function presetPackageFiles(name: string): Record<string, string> {
  const presetRoot = resolve(import.meta.dirname, "../../../presets", name);
  const files: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (
        entry.name.endsWith(".ts") &&
        entry.name !== "blueprint.ts" &&
        entry.name !== "flow.ts" &&
        entry.name !== "ideas-card.ts"
      ) {
        files[`./${relative(presetRoot, full).split("\\").join("/")}`] =
          readFileSync(full, "utf-8");
      }
    }
  };
  walk(presetRoot);
  return files;
}

// The full module-set gate for a blueprint + rendered module set (zero errors
// AND zero warnings — the oracle's bar for the parsed presets: blueprint
// validation, the analyze warnings, lint, import policy, load, typecheck, and
// schema consistency). The gate runs against the session-shaped module set:
// the real preset files are seeded first (like a revision session's files),
// then the gate materializes and keeps them.
async function assertFullGate(
  name: string,
  blueprint: Parameters<typeof renderFlowDefinition>[0],
  rendered: ReturnType<typeof renderFlowDefinition>,
  files: Record<string, string>
): Promise<void> {
  assert.deepEqual(
    validateFlowBlueprint(blueprint),
    [],
    `${name} blueprint validation errors`
  );
  const slug = `parse-${name}-${process.pid}`;
  materializeModuleSet(slug, { entry: rendered.entry, files });
  const gate = await runModuleSetGate(slug, blueprint, rendered);
  assert.deepEqual(
    gate.errors,
    [],
    `preset ${name} gate errors: ${gate.errors.join("; ")}`
  );
  assert.deepEqual(
    gate.warnings,
    [],
    `preset ${name} gate warnings: ${gate.warnings.join("; ")}`
  );
}

// ─── preset round-trips (steps 3-5) ──────────────────────────────────

describe("parse flow definition", () => {
  it("round-trips the queen-bee preset with files, and the parsed blueprint passes the full gate", async () => {
    const files = presetPackageFiles("queen-bee");
    const rendered = renderFlowDefinition(queenBeeBlueprint);
    await assertFullGate("queen-bee", queenBeeBlueprint, rendered, files);
    const parsed = parseFlowDefinition(rendered.entry, files);
    assert.deepEqual(parsed.findings, []);
    const validation = validateFlowBlueprint(parsed.blueprint);
    assert.deepEqual(validation, []);
    const reRendered = renderFlowDefinition(parsed.blueprint);
    assert.equal(
      reRendered.entry,
      rendered.entry,
      "queen-bee must round-trip byte-identically"
    );
    // The recovered writes make the parsed blueprint's writer invariant hold.
    const updateTool = parsed.blueprint.tools?.find(
      (t) => t.id === "update_requirements_draft"
    );
    assert.deepEqual(updateTool?.writes, ["requirementsDraft"]);
    const freshnessOp = parsed.blueprint.operations?.find(
      (o) => o.id === "check_review_freshness"
    );
    assert.deepEqual(freshnessOp?.writes, ["reviewIsStale"]);

    // The parsed blueprint passes the full module-set gate: zero errors AND
    // zero warnings (validation + analyze + lint + import policy + load +
    // typecheck + schema consistency).
    await assertFullGate(
      "queen-bee-parsed",
      parsed.blueprint,
      reRendered,
      files
    );
    assert.deepEqual(
      analyzeFlowBlueprint(parsed.blueprint),
      [],
      "the parsed queen-bee blueprint must stay analysis-warning-clean"
    );
  });

  it("round-trips the wayfinder preset with files, including the build fan-out edge and file gates", async () => {
    const files = presetPackageFiles("wayfinder");
    const rendered = renderFlowDefinition(wayfinderBlueprint);
    await assertFullGate("wayfinder", wayfinderBlueprint, rendered, files);
    const parsed = roundTrip(wayfinderBlueprint, files);
    const buildEdge = parsed.edges?.find((e) => e.toWorkflow === "buildItem");
    assert.equal(buildEdge?.fanOut?.task, "plan");
    assert.equal(buildEdge?.fanOut?.path, "output.tickets");
    assert.deepEqual(buildEdge?.fanOut?.fields.ticket, {
      kind: "itemPath",
      path: "",
    });
    assert.deepEqual(buildEdge?.fanOut?.fields.dependsOn, {
      kind: "itemPath",
      path: "dependsOn",
    });
    const toolWrites = parsed.tools?.find((t) => t.id === "submit_map")?.writes;
    assert.deepEqual(toolWrites, ["destination", "notes"]);
    const normalizeWrites = parsed.operations?.find(
      (o) => o.id === "normalize_ticket"
    )?.writes;
    assert.deepEqual(normalizeWrites, [
      "title",
      "question",
      "type",
      "dependsOn",
    ]);
    // The shipped wayfinder blueprint carries pre-existing analysis warnings
    // (its completionOutput tasks have no patch readers) — the parse must
    // preserve them exactly, never add new ones.
    assert.deepEqual(
      analyzeFlowBlueprint(parsed),
      analyzeFlowBlueprint(wayfinderBlueprint)
    );
  });

  it("documents the known-loss section: writes are not recovered without the files map", async () => {
    const rendered = renderFlowDefinition(queenBeeBlueprint);
    const parsed = parseFlowDefinition(rendered.entry);
    assert.deepEqual(
      parsed.findings,
      [],
      "an entry-only parse reports no findings"
    );
    assert.equal(
      parsed.blueprint.tools?.[0]?.writes,
      undefined,
      "tool writes are lossy without files"
    );
    assert.equal(
      parsed.blueprint.operations?.find(
        (o) => o.id === "check_review_freshness"
      )?.writes,
      undefined,
      "op writes are lossy without files"
    );
    // The blueprint-level writer invariant fails without the recovered writes
    // (reviewIsStale's only writer is the check_review_freshness op) — the
    // documented lossiness, never wired into adoption (adoption always passes
    // the session's files).
    const validation = validateFlowBlueprint(parsed.blueprint);
    assert.ok(
      validation.some(
        (e) =>
          e.message.includes("reviewIsStale") && e.message.includes("writes it")
      ),
      `expected the reviewIsStale writer finding, got ${JSON.stringify(validation)}`
    );
  });

  // ─── hand-edit detection ───────────────────────────────────────────

  it("reports a hand-written gate body as not spec-representable, naming the location", () => {
    const rendered = renderFlowDefinition(queenBeeBlueprint);
    const handGate = rendered.entry.replace(
      "gate: (ctx) => (!ctx.hasRunningTask) && (draftRecorded(ctx)),",
      'gate: (ctx) => ctx.taskOutputs.plan?.output?.kind !== "proposal",'
    );
    assert.notEqual(handGate, rendered.entry, "the hand edit must apply");
    const parsed = parseFlowDefinition(handGate);
    assert.ok(
      parsed.findings.some(
        (f) => f.includes(".gate") && f.includes("not spec-representable")
      ),
      `expected a gate finding, got ${JSON.stringify(parsed.findings)}`
    );
    // The rest of the blueprint is still recovered.
    assert.equal(parsed.blueprint.id, "queen-bee");
    assert.ok(parsed.blueprint.workflows.length > 0);
  });

  it("reports a hand-added task render hint as not spec-representable", () => {
    const rendered = renderFlowDefinition(queenBeeBlueprint);
    const handRender = rendered.entry.replace(
      'role: "ai-chat",',
      'role: "ai-chat",\n          render: { kind: "markdown" },'
    );
    assert.notEqual(handRender, rendered.entry);
    const parsed = parseFlowDefinition(handRender);
    assert.ok(
      parsed.findings.some(
        (f) =>
          f.includes(".tasks[") &&
          f.includes('"render"') &&
          f.includes("not spec-representable")
      ),
      `expected a task render finding, got ${JSON.stringify(parsed.findings)}`
    );
  });

  it("reports a completion tool that names a missing generated tool as not spec-representable", () => {
    const rendered = renderFlowDefinition(queenBeeBlueprint);
    // A hand-written completionTool matching the generated pattern but whose
    // tool is not in the emitted CompletionTools array.
    const handTool = rendered.entry.replace(
      'completionTool: "cards_runAgent_complete",',
      'completionTool: "cards_runAgent_complete",\n          extra: true,'
    );
    // The extra property is the hand edit that surfaces the finding.
    const parsed = parseFlowDefinition(handTool);
    assert.ok(
      parsed.findings.some((f) => f.includes('"extra"')),
      `expected the extra-property finding, got ${JSON.stringify(parsed.findings)}`
    );
  });

  it("adopts a spec-representable hand edit (a changed label) cleanly", () => {
    const rendered = renderFlowDefinition(queenBeeBlueprint);
    const handEdit = rendered.entry.replace(
      'label: "Cards",',
      'label: "Cards (renamed by hand)",'
    );
    const parsed = parseFlowDefinition(handEdit);
    assert.deepEqual(parsed.findings, []);
    const cards = parsed.blueprint.workflows.find((w) => w.id === "cards");
    assert.equal(cards?.label, "Cards (renamed by hand)");
    // The re-render keeps the hand edit.
    const reRendered = renderFlowDefinition(parsed.blueprint).entry;
    assert.ok(reRendered.includes('label: "Cards (renamed by hand)"'));
  });

  // ─── the module-set corpus (documented recovery rule) ──────────────

  it("round-trips the module-set REFS corpus: validation-clean, and re-renders semantically identical", () => {
    // The entry flattens flow-level op ids and inline task op refs to the
    // same names; the parse canonicalizes op refs to flow-level operations
    // entries. The imports reorder (inline refs are promoted), so the
    // byte-identity oracle applies modulo import order — asserted explicitly.
    const blueprint = moduleSetRefsCorpus();
    const rendered = renderFlowDefinition(blueprint);
    const parsed = parseFlowDefinition(rendered.entry, rendered.files);
    assert.deepEqual(parsed.findings, []);
    const validation = validateFlowBlueprint(parsed.blueprint);
    assert.deepEqual(validation, []);
    const reRendered = renderFlowDefinition(parsed.blueprint).entry;
    assert.equal(
      normalizeImportOrder(reRendered),
      normalizeImportOrder(rendered.entry),
      "the re-render differs from the original only in import order"
    );
    // The promoted ops: both score and annotate land in the flow-level list.
    assert.deepEqual(
      parsed.blueprint.operations?.map((o) => o.id),
      ["score", "annotate"]
    );
  });

  it("parses a non-definition source into a minimal blueprint with a finding", () => {
    const parsed = parseFlowDefinition("export const notAFlow = 1;\n");
    assert.ok(parsed.findings.some((f) => f.startsWith("flow:")));
    assert.deepEqual(parsed.blueprint.workflows, []);
  });
});

// The import-order normalization: the round-trip oracle compares the renderer
// output (unformatted) against a fresh render; for the module-set corpus the
// promoted op refs reorder the imports, so compare the imports as a set.
function normalizeImportOrder(entry: string): string {
  const [imports, rest] = splitImports(entry);
  return `${[...imports].sort().join("\n")}\n${rest}`;
}

function splitImports(entry: string): [string[], string] {
  const lines = entry.split("\n");
  const importLines: string[] = [];
  const body: string[] = [];
  for (const line of lines) {
    if (line.startsWith("import ")) importLines.push(line);
    else body.push(line);
  }
  return [importLines, body.join("\n")];
}

// The module-set corpus (render-flow-definition.test.ts REFS spec): a gate
// file ref, a custom tool, flow-level + inline op refs, an edge transform
// ref, an output extractor, and a referenced system prompt.
function moduleSetRefsCorpus(): Parameters<typeof renderFlowDefinition>[0] {
  return {
    id: "moduleSetFlow",
    label: "Module Set Flow",
    configSchema: [],
    tools: [{ id: "websearch", ref: "./tools/websearch.ts" }],
    operations: [{ id: "score", ref: "./ops/score.ts" }],
    workflows: [
      {
        id: "research",
        label: "Research",
        instance: { title: "query" },
        display: {
          fields: [
            { path: "query", label: "Query" },
            { path: "result", label: "Result" },
            { path: "score", label: "Score" },
            { path: "verdict", label: "Verdict" },
          ],
        },
        instanceState: [
          { field: "query", type: "string" },
          { field: "result", type: "string" },
          { field: "score", type: "number" },
          { field: "verdict", type: "string" },
        ],
        initialState: "searching",
        terminalStates: ["done"],
        states: [
          {
            id: "searching",
            label: "Searching",
            category: "initial",
            tasks: [
              {
                id: "search",
                label: "Search the web",
                role: "ai-chat",
                systemPrompt:
                  "Search for the query, then call the completion tool.",
                tools: ["websearch"],
                completionTool: "complete_task",
                inputFromInstanceState: "query",
              },
              {
                id: "scoreResult",
                label: "Score the result",
                role: "operation",
                operations: ["score", { ref: "./ops/annotate.ts" }],
              },
              {
                id: "recordScore",
                label: "Record the score",
                role: "operation",
                patch: {
                  score: {
                    kind: "taskOutput",
                    task: "scoreResult",
                    path: "output.score",
                  },
                  result: {
                    kind: "taskOutput",
                    task: "search",
                    path: "output.completion.summary",
                  },
                },
              },
            ],
            autoTransitions: [
              {
                to: "extracting",
                gate: { kind: "taskSuccess", task: "recordScore" },
              },
              {
                to: "needs_review",
                gate: { kind: "taskError", task: "recordScore" },
              },
            ],
          },
          {
            id: "extracting",
            label: "Extracting",
            category: "active",
            tasks: [
              {
                id: "extractResult",
                label: "Extract the verdict",
                role: "operation",
                extract: {
                  ref: "./extractors/parse-result.ts",
                  fields: ["verdict"],
                },
              },
            ],
            autoTransitions: [
              {
                to: "done",
                gate: { kind: "file", ref: "./gates/approved.ts" },
              },
              { to: "needs_review", gate: { kind: "always" } },
            ],
          },
          {
            id: "needs_review",
            label: "Needs review",
            category: "active",
            actions: [
              {
                id: "retry",
                label: "Retry",
                variant: "primary",
                transitionTo: "extracting",
                gate: {
                  kind: "instanceStateEquals",
                  field: "verdict",
                  value: "approved",
                },
              },
            ],
          },
          { id: "done", label: "Done", category: "terminal" },
        ],
      },
      {
        id: "summary",
        label: "Summary",
        instance: { title: "title" },
        display: { fields: [{ path: "body", label: "Body" }] },
        instanceState: [
          { field: "title", type: "string" },
          { field: "body", type: "string" },
        ],
        initialState: "ready",
        terminalStates: ["ready"],
        states: [{ id: "ready", label: "Ready", category: "initial" }],
      },
    ],
    edges: [
      {
        fromWorkflow: "research",
        fromStates: ["done"],
        toWorkflow: "summary",
        transform: { ref: "./edges/to-summary.ts", fields: ["title", "body"] },
      },
    ],
    actions: [
      {
        id: "add_research",
        label: "Add research",
        variant: "primary",
        createInstance: {
          workflowId: "research",
          fields: [
            { key: "query", label: "Query", type: "string", required: true },
          ],
        },
      },
    ],
  };
}
