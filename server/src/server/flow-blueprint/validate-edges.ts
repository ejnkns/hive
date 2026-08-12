/** @private — flow-edge validation (runs after the workflow walk). */

import { DOTTED_PATH } from "./blueprint-constants.ts";
import type {
  BlueprintValidationContext,
  FlowBlueprint,
} from "./blueprint-types.ts";
import { checkLiteralMatches, validateValueSpec } from "./validate-values.ts";

export function validateEdges(
  blueprint: FlowBlueprint,
  context: BlueprintValidationContext,
  error: (path: string, message: string) => void
): void {
  // ── edges ──
  for (const [eIndex, edge] of (blueprint.edges ?? []).entries()) {
    const ePath = `edges[${eIndex}]`;
    const from = context.workflowById.get(edge.fromWorkflow);
    const to = context.workflowById.get(edge.toWorkflow);
    if (!from) {
      error(
        `${ePath}.fromWorkflow`,
        `unknown source workflow ${JSON.stringify(edge.fromWorkflow)}`
      );
      continue;
    }
    if (!to) {
      error(
        `${ePath}.toWorkflow`,
        `unknown target workflow ${JSON.stringify(edge.toWorkflow)}`
      );
      continue;
    }
    const fromStates = context.stateIdsByWorkflow.get(from.id);
    const fromTaskIds = context.taskIdsByWorkflow.get(from.id);
    const toTypes = context.instanceStateById.get(to.id);
    if (!fromStates || !fromTaskIds || !toTypes) continue;
    for (const state of edge.fromStates) {
      if (!fromStates.has(state)) {
        error(
          `${ePath}.fromStates`,
          `source workflow "${from.id}" has no state ${JSON.stringify(state)}`
        );
      }
    }
    for (const [field, value] of Object.entries(edge.fields ?? {})) {
      const type = toTypes.get(field);
      if (!type) {
        error(
          `${ePath}.fields.${field}`,
          `edge writes "${field}" which is not declared in target workflow "${to.id}" instanceState`
        );
      }
      for (const e of validateValueSpec(
        value,
        fromTaskIds,
        `${ePath}.fields.${field}`,
        context.completionOutputById.get(from.id)
      )) {
        error(e.path, e.message);
      }
      if (value.kind === "instanceId") {
        error(
          `${ePath}.fields.${field}`,
          `instanceId values are only valid in patch ops, not edge transforms`
        );
      }
      if (value.kind === "literal" && type) {
        for (const e of checkLiteralMatches(
          value.value,
          type,
          `${ePath}.fields.${field}`
        )) {
          error(e.path, e.message);
        }
      }
    }
    if (edge.fanOut) {
      const fan = edge.fanOut;
      if (!fromTaskIds.has(fan.task)) {
        error(
          `${ePath}.fanOut.task`,
          `fanOut reads task "${fan.task}" which source workflow "${from.id}" does not declare`
        );
      }
      if (typeof fan.path !== "string" || !DOTTED_PATH.test(fan.path)) {
        error(`${ePath}.fanOut.path`, `fanOut path must be a dotted path`);
      }
      for (const [field, value] of Object.entries(fan.fields)) {
        const type = toTypes.get(field);
        if (!type) {
          error(
            `${ePath}.fanOut.fields.${field}`,
            `fanOut writes "${field}" which is not declared in target workflow "${to.id}" instanceState`
          );
        }
        if (value.kind === "literal") {
          if (type) {
            for (const e of checkLiteralMatches(
              value.value,
              type,
              `${ePath}.fanOut.fields.${field}`
            )) {
              error(e.path, e.message);
            }
          }
          continue;
        }
        if (value.kind === "instanceId") {
          error(
            `${ePath}.fanOut.fields.${field}`,
            `instanceId values are only valid in patch ops, not fan-out fields`
          );
          continue;
        }
        if (value.kind === "itemPath" && !DOTTED_PATH.test(value.path)) {
          error(
            `${ePath}.fanOut.fields.${field}`,
            `itemPath must be a dotted path (got ${JSON.stringify(value.path)})`
          );
        }
      }
    }
  }
}
