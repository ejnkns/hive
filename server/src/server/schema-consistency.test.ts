// === SCHEMA CONSISTENCY CHECK (suite) ===
//
// Thin wrapper over the check-as-a-service (schema-consistency.ts). The logic
// itself lives in the service; this suite enumerates the source sets and
// asserts the invariants:
//
//   1. every workflow declares a workflowInstanceState anchor (declared type)
//   2. every authored write is a declared field (writes ⊆ declared)
//   3. every read has a writer: authored writes ∪ engine-provided fields
//      (reads ⊆ writes)
//   4. engine-read fields (the dependsOn backstop) are declared
//   5. dead declarations and write-without-read fields surface as warnings
//
// Two source sets are checked: the registered presets (multi-file, on disk)
// and the single-file definition shape user definitions and the AI generator
// produce. A third preset or a saved user flow cannot silently escape.

import assert from "node:assert/strict";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  listRegisteredDefinitions,
  registerUserDefinition,
  resetFlowDefinitionsForTest,
  setDefinitionsBasePathForTest,
} from "./flow-definitions.ts";
import { checkDefinitionSources } from "./schema-consistency.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── preset enumeration ────────────────────────────────────────────────

const PRESETS = [
  { id: "queen-bee", dir: "presets/queen-bee" },
  { id: "wayfinder", dir: "presets/wayfinder" },
] as const;

const PRESET_ROOT = join(__dirname, "..", "..", "..");

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectFiles(full));
    } else if (full.endsWith(".ts") && !full.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

// ─── the suite ─────────────────────────────────────────────────────────

describe("schema consistency", () => {
  for (const preset of PRESETS) {
    it(`${preset.id} workflows hold the state contract`, () => {
      const presetRoot = join(PRESET_ROOT, preset.dir);
      const files = collectFiles(presetRoot).map((path) => ({
        path,
        source: readFileSync(path, "utf8"),
      }));
      const report = checkDefinitionSources(files);

      assert.ok(
        report.workflows.length >= 2,
        `expected at least 2 workflows in ${preset.id}, found ${report.workflows.length}`
      );
      for (const warning of report.warnings) {
        // eslint-disable-next-line no-console
        console.log(`schema-consistency warning: ${warning}`);
      }
      assert.deepEqual(report.errors, []);
    });
  }

  describe("single-file definitions (user / generated shape)", () => {
    // A minimal but real single-file definition: two workflows, an edge
    // transform writing a declared field, a patch op writing another, gates
    // reading both. Should pass with zero errors and zero warnings.
    const KNOWN_GOOD = `
import { defineWorkflow } from "workflow-engine/workflow-types";
import { defineOperations } from "workflow-engine/runners";

type ReviewItemState = {
  verdict?: string;
};

type CardsItemState = {
  cardSpec?: Record<string, unknown>;
};

export const reviewOperations = defineOperations<ReviewItemState>({
  record_verdict: (task, params, ctx) => {
    ctx.patchWorkflowInstanceState({ verdict: params.verdict as string | undefined });
    return { ok: true };
  },
});

const reviewWf = defineWorkflow({
  id: "review",
  label: "Review",
  taskOutputs: {
    runReview: {} as { status?: string; completion?: { verdict?: string } },
  },
  workflowInstanceState: {} as ReviewItemState,
  states: [
    {
      id: "ready",
      label: "Ready",
      category: "initial",
      actions: [
        {
          id: "run",
          label: "Run",
          variant: "primary",
          transitionTo: "running",
        },
      ],
    },
    {
      id: "running",
      label: "Running",
      category: "active",
      tasks: [
        {
          id: "runReview",
          label: "Run review",
          trigger: "auto",
          role: "ai-task",
          tools: ["read_file"],
          completionTool: "complete_task",
          operations: ["record_verdict"],
          operationInputs: { verdict: "pending" },
        },
      ],
      autoTransitions: [
        {
          to: "approved",
          gate: (ctx) =>
            ctx.taskOutputs.runReview?.status === "success" &&
            ctx.workflowInstanceState.verdict === "approved",
        },
        { to: "failed", gate: (ctx) => ctx.taskOutputs.runReview?.status === "error" },
      ],
    },
    { id: "approved", label: "Approved", category: "terminal" },
    { id: "failed", label: "Failed", category: "error" },
  ],
  initial: "ready",
  terminalStates: ["approved", "failed"],
});

const cardsWf = defineWorkflow({
  id: "cards",
  label: "Cards",
  instance: { title: "cardSpec.title" },
  taskOutputs: {} as Record<string, never>,
  workflowInstanceState: {} as CardsItemState,
  states: [
    {
      id: "ready",
      label: "Ready",
      category: "initial",
      actions: [
        {
          id: "archive",
          label: "Archive",
          variant: "secondary",
          transitionTo: "done",
        },
      ],
    },
    { id: "done", label: "Done", category: "terminal" },
  ],
  initial: "ready",
  terminalStates: ["done"],
});

export const flow = {
  id: "review-flow",
  label: "Review Flow",
  configSchema: [{ key: "basePath", label: "Base path", type: "string", required: true }],
  workflows: [reviewWf, cardsWf],
  operations: { ...reviewOperations },
  actions: [
    {
      id: "add_card",
      label: "Add card",
      variant: "primary",
      createInstance: {
        workflowId: "cards",
        fields: [{ key: "cardSpec", label: "Card spec", type: "string" }],
      },
    },
  ],
  edges: [
    {
      fromWorkflow: "review",
      fromStates: ["approved"],
      toWorkflow: "cards",
      transform: (source) => ({ cardSpec: source.runReview?.output }),
    },
  ],
};
`;

    it("accepts a well-formed single-file definition", () => {
      const report = checkDefinitionSources([
        { path: "review-flow.ts", source: KNOWN_GOOD },
      ]);
      assert.deepEqual(report.errors, []);
      assert.deepEqual(report.warnings, []);
      assert.deepEqual(report.workflows.map((w) => w.workflowId).sort(), [
        "cards",
        "review",
      ]);
    });

    it("flags a read with no writer", () => {
      const source = KNOWN_GOOD.replace(
        'ctx.workflowInstanceState.verdict === "approved"',
        'ctx.workflowInstanceState.missingField === "approved"'
      );
      const report = checkDefinitionSources([{ path: "bad.ts", source }]);
      assert.ok(
        report.errors.some((e) => e.includes("reads with no writer")),
        `expected a read-with-no-writer error, got: ${report.errors.join("; ")}`
      );
    });

    it("counts editFields keys as writers for the every-read-has-a-writer rule", () => {
      // Strip the cards workflow's other writers of `cardSpec` (the add_card
      // createInstance payload and the edge transform) and declare it in
      // editFields instead: the instance-edit form is now the writer, so the
      // `instance: { title: "cardSpec.title" }` read must stay satisfied.
      const source = KNOWN_GOOD.replace(
        `      createInstance: {\n        workflowId: "cards",\n        fields: [{ key: "cardSpec", label: "Card spec", type: "string" }],\n      },`,
        `      createInstance: { workflowId: "cards" },`
      )
        .replace(
          `      transform: (source) => ({ cardSpec: source.runReview?.output }),`,
          ``
        )
        .replace(
          `  workflowInstanceState: {} as CardsItemState,`,
          `  workflowInstanceState: {} as CardsItemState,\n  editFields: [{ key: "cardSpec", label: "Card spec", type: "string" }],`
        );
      const report = checkDefinitionSources([
        { path: "edit-fields.ts", source },
      ]);
      assert.deepEqual(report.errors, []);
      // An undeclared editFields key is still an undeclared write.
      const undeclared = source.replace(
        'editFields: [{ key: "cardSpec"',
        'editFields: [{ key: "nope"'
      );
      const undeclaredReport = checkDefinitionSources([
        { path: "bad.ts", source: undeclared },
      ]);
      assert.ok(
        undeclaredReport.errors.some((e) =>
          e.includes("writes undeclared in the state type")
        ),
        `expected an undeclared-write error, got: ${undeclaredReport.errors.join("; ")}`
      );
    });

    it("flags a write that is never read as a warning, and an undeclared write as an error", () => {
      // The KNOWN_GOOD flow's record_verdict op writes `verdict`, which the
      // approved gate reads — no warning. Remove the gate's read to expose
      // write-without-read.
      const unread = KNOWN_GOOD.replace(
        'ctx.workflowInstanceState.verdict === "approved"',
        "true"
      );
      const unreadReport = checkDefinitionSources([
        { path: "bad.ts", source: unread },
      ]);
      assert.ok(
        unreadReport.warnings.some((w) => w.includes("written but never read")),
        `expected a write-without-read warning, got: ${unreadReport.warnings.join("; ")}`
      );

      // A patch writing a field the type never declares is an error.
      const undeclared = KNOWN_GOOD.replace(
        "patchWorkflowInstanceState({ verdict:",
        "patchWorkflowInstanceState({ undeclaredField:"
      );
      const undeclaredReport = checkDefinitionSources([
        { path: "bad.ts", source: undeclared },
      ]);
      assert.ok(
        undeclaredReport.errors.some((e) =>
          e.includes("writes undeclared in the state type")
        ),
        `expected an undeclared-write error, got: ${undeclaredReport.errors.join("; ")}`
      );
    });

    it("flags a missing workflowInstanceState anchor", () => {
      const source = KNOWN_GOOD.replace(
        "  workflowInstanceState: {} as ReviewItemState,\n",
        ""
      );
      const report = checkDefinitionSources([{ path: "bad.ts", source }]);
      assert.ok(
        report.errors.some((e) =>
          e.includes("missing workflowInstanceState anchor")
        ),
        `expected an anchor error, got: ${report.errors.join("; ")}`
      );
    });
  });

  describe("registered user definitions", () => {
    // The registry path: a saved user definition's source is checked when it
    // is registered — the same sources the save route annotates. A user flow
    // cannot silently escape the check.
    let baseDir: string;

    // A minimal clean single-file definition (one workflow, no state).
    const REGISTERED_GOOD = `
import { defineWorkflow } from "workflow-engine/workflow-types";

const wf = defineWorkflow({
  id: "registered",
  label: "Registered",
  taskOutputs: {} as Record<string, never>,
  workflowInstanceState: {} as Record<string, unknown>,
  states: [
    { id: "pending", label: "Pending", category: "initial" },
    { id: "done", label: "Done", category: "terminal" },
  ],
  initial: "pending",
  terminalStates: ["done"],
});

export const flow = {
  id: "registered-flow",
  label: "Registered Flow",
  workflows: [wf],
  edges: [],
};
`;

    beforeEach(() => {
      baseDir = mkdtempSync(join(tmpdir(), "hive-defs-check-"));
      setDefinitionsBasePathForTest(baseDir);
      resetFlowDefinitionsForTest();
    });

    afterEach(() => {
      rmSync(baseDir, { recursive: true, force: true });
      resetFlowDefinitionsForTest();
    });

    it("reports findings for every registered user definition source", async () => {
      await registerUserDefinition({
        name: "Registered Flow",
        source: REGISTERED_GOOD,
      });
      // A gate reading a field nothing writes — the check's motivating error
      // class, in the exact shape a saved user definition can take.
      const inconsistent = `
import { defineWorkflow } from "workflow-engine/workflow-types";

type BadState = { missingField?: string };

const wf = defineWorkflow({
  id: "inconsistent",
  label: "Inconsistent",
  taskOutputs: {} as Record<string, never>,
  workflowInstanceState: {} as BadState,
  states: [
    {
      id: "pending",
      label: "Pending",
      category: "initial",
      autoTransitions: [
        {
          to: "done",
          gate: (ctx) => ctx.workflowInstanceState.missingField === "x",
        },
      ],
    },
    { id: "done", label: "Done", category: "terminal" },
  ],
  initial: "pending",
  terminalStates: ["done"],
});

export const flow = {
  id: "inconsistent-flow",
  label: "Inconsistent Flow",
  workflows: [wf],
  edges: [],
};
`;
      await registerUserDefinition({
        name: "Inconsistent Flow",
        source: inconsistent,
      });

      const userDefinitions = listRegisteredDefinitions().filter(
        (d) => !d.builtIn && d.source !== undefined
      );
      assert.equal(userDefinitions.length, 2);

      const report = checkDefinitionSources(
        userDefinitions.map((d) => ({
          path: `${d.id}.ts`,
          source: d.source as string,
        }))
      );

      const registeredFlow = report.workflows.find(
        (w) => w.workflowId === "registered" && w.errors.length === 0
      );
      assert.ok(registeredFlow, "the clean definition reports no errors");

      assert.ok(
        report.errors.some((e) => e.includes("reads with no writer")),
        `expected the inconsistent flow's finding, got: ${report.errors.join("; ")}`
      );
    });
  });

  describe("structural soundness", () => {
    // Small single-file definitions with clean state contracts (no reads/
    // writes), isolating the state-machine findings. The anchor is
    // `Record<string, unknown>` so only structural warnings can appear.
    const HEADER = `
import { defineWorkflow } from "workflow-engine/workflow-types";

const wf = defineWorkflow({
  id: "w",
  label: "W",
  taskOutputs: {} as Record<string, never>,
  workflowInstanceState: {} as Record<string, unknown>,
`;
    const FOOTER = `
  initial: "idle",
  terminalStates: ["done"],
});

export const flow = {
  id: "structural-flow",
  label: "Structural Flow",
  workflows: [wf],
  edges: [],
};
`;

    function check(source: string) {
      return checkDefinitionSources([{ path: "structural.ts", source }])
        .warnings;
    }

    it("flags a state nothing can transition into", () => {
      const warnings = check(
        HEADER +
          `
  states: [
    { id: "idle", label: "Idle", category: "initial", actions: [{ id: "go", label: "Go", variant: "primary", transitionTo: "done" }] },
    { id: "orphan", label: "Orphan", category: "active", actions: [{ id: "x", label: "X", variant: "secondary", transitionTo: "done" }] },
    { id: "done", label: "Done", category: "terminal" },
  ],
` +
          FOOTER
      );
      assert.ok(
        warnings.some((w) => w.includes('state "orphan" is unreachable')),
        `expected an unreachable-state warning, got: ${warnings.join("; ")}`
      );
    });

    it("flags a non-terminal state with no way out", () => {
      const warnings = check(
        HEADER +
          `
  states: [
    { id: "idle", label: "Idle", category: "initial", actions: [{ id: "go", label: "Go", variant: "primary", transitionTo: "limbo" }] },
    { id: "limbo", label: "Limbo", category: "active" },
    { id: "done", label: "Done", category: "terminal" },
  ],
` +
          FOOTER
      );
      assert.ok(
        warnings.some((w) => w.includes('state "limbo" has no way out')),
        `expected a stuck-state warning, got: ${warnings.join("; ")}`
      );
    });

    it("flags a never-gated transition", () => {
      const warnings = check(
        HEADER +
          `
  states: [
    { id: "idle", label: "Idle", category: "initial", actions: [{ id: "go", label: "Go", variant: "primary", transitionTo: "in_progress" }] },
    { id: "in_progress", label: "In Progress", category: "active", autoTransitions: [{ to: "done", gate: () => false }] },
    { id: "done", label: "Done", category: "terminal" },
  ],
` +
          FOOTER
      );
      assert.ok(
        warnings.some((w) => w.includes("gated never")),
        `expected a never-gated-transition warning, got: ${warnings.join("; ")}`
      );
    });

    it("flags a transition targeting an unknown state", () => {
      const warnings = check(
        HEADER +
          `
  states: [
    { id: "idle", label: "Idle", category: "initial", actions: [{ id: "go", label: "Go", variant: "primary", transitionTo: "done" }], autoTransitions: [{ to: "nowhere", gate: () => true }] },
    { id: "done", label: "Done", category: "terminal" },
  ],
` +
          FOOTER
      );
      assert.ok(
        warnings.some((w) => w.includes('targets unknown state "nowhere"')),
        `expected an unknown-target warning, got: ${warnings.join("; ")}`
      );
    });

    it("reports no structural warnings for a sound workflow", () => {
      const warnings = check(
        HEADER +
          `
  states: [
    { id: "idle", label: "Idle", category: "initial", actions: [{ id: "go", label: "Go", variant: "primary", transitionTo: "running" }] },
    { id: "running", label: "Running", category: "active", autoTransitions: [{ to: "done", gate: () => true }] },
    { id: "done", label: "Done", category: "terminal" },
  ],
` +
          FOOTER
      );
      assert.deepEqual(warnings, []);
    });
  });
});
