/** @private — per-workflow contract extraction (reads/writes/declared from
 * the definition source) and the read/write invariant evaluation. */

import ts from "typescript";
import { engineCapabilities } from "workflow-engine/capabilities-manifest";
import { declaredFieldsFor } from "./anchors.ts";
import type { ObjectLiteral } from "./ast.ts";
import { arrayOf, objectOf, propertyOf, stringValue } from "./ast.ts";
import { collectPatchWrites, collectStateReads } from "./state-access.ts";
import { assessWorkflowStructure } from "./structure.ts";

type WorkflowContract = {
  workflowId: string;
  declared: Set<string> | undefined;
  reads: Set<string>;
  writes: Set<string>;
  structure: string[];
};

const engineProvided = new Set(
  Object.keys(engineCapabilities.stateFields.engineProvided)
);
const engineRead = new Set(
  Object.keys(engineCapabilities.stateFields.engineRead)
);

export function extractWorkflow(
  config: ObjectLiteral,
  files: ts.SourceFile[],
  opsByName: Map<string, ts.Node>,
  toolsByName: Map<string, ts.Node>,
  edgeWrites: Map<string, Set<string>>,
  payloadWrites: Map<string, Set<string>>
): WorkflowContract {
  const workflowId =
    stringValue(propertyOf(config, "id")?.initializer) ?? "unknown";
  const declared = declaredFieldsFor(config, files);
  const reads = new Set<string>();
  const writes = new Set<string>();

  // UI hint reads: instance title/subtitle and display field paths are dotted
  // paths into the instance state — a hint pointing at a never-written field
  // is dead UI. Static labels ("Integration") don't reference state, so only
  // segments that resolve to a declared field count as reads.
  const firstSegment = (path: string | undefined) => path?.split(".")[0];
  const instanceHint = objectOf(config, "instance");
  if (instanceHint) {
    for (const key of ["title", "subtitle"] as const) {
      const value = firstSegment(
        stringValue(propertyOf(instanceHint, key)?.initializer)
      );
      if (value !== undefined && declared?.has(value) === true)
        reads.add(value);
    }
  }
  const displayHint = objectOf(config, "display");
  const displayFields = displayHint
    ? arrayOf(displayHint, "fields")
    : undefined;
  for (const field of displayFields ?? []) {
    if (!ts.isObjectLiteralExpression(field)) continue;
    const value = firstSegment(
      stringValue(propertyOf(field, "path")?.initializer)
    );
    if (value !== undefined && declared?.has(value) === true) reads.add(value);
  }

  // Gates (inline in the config's states) + engine reads from the config.
  for (const stateExpr of arrayOf(config, "states") ?? []) {
    if (!ts.isObjectLiteralExpression(stateExpr)) continue;
    for (const listName of ["autoTransitions", "actions"] as const) {
      for (const item of arrayOf(stateExpr, listName) ?? []) {
        if (!ts.isObjectLiteralExpression(item)) continue;
        const gate = propertyOf(item, "gate");
        if (gate) collectStateReads(gate.initializer, reads);
        if (propertyOf(item, "dependsOnState")) reads.add("dependsOn");
      }
    }
    for (const task of arrayOf(stateExpr, "tasks") ?? []) {
      if (!ts.isObjectLiteralExpression(task)) continue;
      const workspace = stringValue(
        propertyOf(task, "workspacePath")?.initializer
      );
      if (workspace?.startsWith("@instance:")) {
        reads.add(workspace.slice("@instance:".length));
      }
      const input = stringValue(
        propertyOf(task, "inputFromInstanceState")?.initializer
      );
      if (input) {
        const segment = input.split(".")[0];
        if (segment) reads.add(segment);
      }
      const persist = objectOf(task, "persist");
      const persistPath = persist
        ? stringValue(propertyOf(persist, "path")?.initializer)
        : undefined;
      if (persistPath?.includes("{attempt}")) reads.add("attempt");
    }
  }

  // Ops this workflow's tasks reference: their reads and writes.
  const opNames = new Set<string>();
  const toolNames = new Set<string>();
  for (const stateExpr of arrayOf(config, "states") ?? []) {
    if (!ts.isObjectLiteralExpression(stateExpr)) continue;
    for (const task of arrayOf(stateExpr, "tasks") ?? []) {
      if (!ts.isObjectLiteralExpression(task)) continue;
      for (const opName of arrayOf(task, "operations") ?? []) {
        const name = stringValue(opName);
        if (name) opNames.add(name);
      }
      for (const toolName of arrayOf(task, "tools") ?? []) {
        const name = stringValue(toolName);
        if (name) toolNames.add(name);
      }
    }
  }
  for (const name of opNames) {
    const fn = opsByName.get(name);
    if (fn) {
      collectStateReads(fn, reads);
      collectPatchWrites(fn, writes);
    } else {
      const op = engineCapabilities.engineOperations.find(
        (o) => o.name === name
      );
      if (op) {
        for (const field of op.reads) reads.add(field);
        for (const field of op.writes) writes.add(field);
      }
    }
  }
  for (const name of toolNames) {
    const fn = toolsByName.get(name);
    if (fn) collectPatchWrites(fn, writes);
  }

  // Edges + createInstance payloads feeding this workflow.
  for (const field of edgeWrites.get(workflowId) ?? []) writes.add(field);
  for (const field of payloadWrites.get(workflowId) ?? []) writes.add(field);

  // Manual-action input fields write the acting instance's state.
  for (const stateExpr of arrayOf(config, "states") ?? []) {
    if (!ts.isObjectLiteralExpression(stateExpr)) continue;
    for (const action of arrayOf(stateExpr, "actions") ?? []) {
      if (!ts.isObjectLiteralExpression(action)) continue;
      for (const field of arrayOf(action, "fields") ?? []) {
        if (!ts.isObjectLiteralExpression(field)) continue;
        const key = stringValue(propertyOf(field, "key")?.initializer);
        if (key) writes.add(key);
      }
    }
  }

  // editFields declare the instance's editable fields — a user-facing writer:
  // the instance-edit form patches exactly these keys into instance state.
  for (const field of arrayOf(config, "editFields") ?? []) {
    if (!ts.isObjectLiteralExpression(field)) continue;
    const key = stringValue(propertyOf(field, "key")?.initializer);
    if (key) writes.add(key);
  }

  return {
    workflowId,
    declared,
    reads,
    writes,
    structure: assessWorkflowStructure(config, workflowId),
  };
}

// ─── the invariants ────────────────────────────────────────────────────

export function evaluateContract(contract: WorkflowContract): {
  errors: string[];
  warnings: string[];
} {
  const { workflowId, declared, reads, writes } = contract;
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Anchor required — the declared state type is the contract. Without it
  // the write/read invariants cannot be evaluated (nothing is declared), so
  // the remaining checks are skipped for this workflow.
  if (declared === undefined) {
    errors.push(
      `[${workflowId}] missing workflowInstanceState anchor — every workflow must declare its state type`
    );
    return { errors, warnings };
  }

  // 2. Authored writes must be declared fields.
  const authoredWrites = new Set(
    [...writes].filter((f) => !engineProvided.has(f))
  );
  const undeclaredWrites = [...authoredWrites].filter((f) => !declared.has(f));
  if (undeclaredWrites.length > 0) {
    errors.push(
      `[${workflowId}] writes undeclared in the state type: ${undeclaredWrites.join(", ")}`
    );
  }

  // 3. Every read must have a writer (authored writes ∪ engine-provided).
  const allWrites = new Set([...writes, ...engineProvided]);
  const unwrittenReads = [...reads].filter((f) => !allWrites.has(f));
  if (unwrittenReads.length > 0) {
    errors.push(
      `[${workflowId}] reads with no writer: ${unwrittenReads.join(", ")} ` +
        `(reads: ${[...reads].sort().join(", ")}; writes: ${[...allWrites].sort().join(", ")})`
    );
  }

  // 4. Engine-read fields the workflow actually reads (the dependsOn
  // backstop) must be declared. Only enforced when read — a workflow that
  // never uses dependsOnState doesn't need the field.
  const undeclaredEngineReads = [...engineRead].filter(
    (f) => reads.has(f) && !declared.has(f)
  );
  if (undeclaredEngineReads.length > 0) {
    errors.push(
      `[${workflowId}] engine-read fields not declared: ${undeclaredEngineReads.join(", ")}`
    );
  }

  // 5. Warnings: dead declarations and write-without-read fields. Engine-
  // provided fields are exempt — a flow not using one is fine, not drift.
  const allReads = new Set([...reads, ...engineRead]);
  const neverRead = [...declared].filter(
    (f) => !allReads.has(f) && !engineProvided.has(f)
  );
  if (neverRead.length > 0) {
    warnings.push(`[${workflowId}] fields never read: ${neverRead.join(", ")}`);
  }
  const writtenNeverRead = [...allWrites].filter(
    (f) => !allReads.has(f) && !engineProvided.has(f)
  );
  if (writtenNeverRead.length > 0) {
    warnings.push(
      `[${workflowId}] written but never read: ${writtenNeverRead.join(", ")}`
    );
  }

  return { errors, warnings };
}

// ─── the check ────────────────────────────────────────────────────────
