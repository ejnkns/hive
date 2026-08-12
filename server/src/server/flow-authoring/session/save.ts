/** @private — the one save implementation, shared by the save_definition tool
 * (the agent saves from chat) and the synchronous save route (the editor's
 * Save button): register the session's generated source as a definition —
 * create on the first save, update by savedDefinitionId afterwards. Only
 * flow-authoring/session.ts (re-export) and session/tools/save-definition.ts
 * import from here. */

import type { FlowBlueprint } from "../../flow-blueprint.ts";
import {
  registerUserDefinition,
  updateUserDefinition,
} from "../../flow-definitions.ts";
import { checkDefinitionSources } from "../../schema-consistency.ts";
import type { AuthoringItemState } from "./state.ts";

export async function saveAuthoringDefinition(
  state: AuthoringItemState,
  nameOverride?: string
): Promise<{
  id: string;
  name: string;
  checkErrors: string[];
  checkWarnings: string[];
}> {
  const source = typeof state.source === "string" ? state.source : "";
  if (source === "") {
    throw new Error(
      "Nothing to save — ask the agent to generate a definition first."
    );
  }
  const suggested =
    typeof state.suggestedName === "string" ? state.suggestedName : "";
  const name =
    nameOverride !== undefined && nameOverride.trim() !== ""
      ? nameOverride.trim()
      : suggested;
  if (name === "") {
    throw new Error("Definition name is required");
  }

  const targetId = state.savedDefinitionId;
  let blueprint: FlowBlueprint | undefined;
  if (typeof state.blueprint === "string" && state.blueprint !== "") {
    try {
      blueprint = JSON.parse(state.blueprint) as FlowBlueprint;
    } catch {
      // A malformed stored blueprint is not a save blocker — the rendered
      // source is the truth.
    }
  }
  const record = targetId
    ? await updateUserDefinition(targetId, {
        name,
        source,
        files: state.files,
        blueprint,
      })
    : await registerUserDefinition({
        name,
        source,
        blueprint,
        files: state.files,
      });
  const check = checkDefinitionSources([{ path: `${record.id}.ts`, source }]);
  return {
    id: record.id,
    name: record.name,
    checkErrors: check.errors,
    checkWarnings: check.warnings,
  };
}

// The instance-state patch both save paths apply on success, so the editor
// reflects the saved definition from the snapshot.
export function savePatch(result: {
  id: string;
  name: string;
  checkErrors: string[];
  checkWarnings: string[];
}): Pick<
  AuthoringItemState,
  "savedDefinitionId" | "savedName" | "saveFindings"
> {
  return {
    savedDefinitionId: result.id,
    savedName: result.name,
    saveFindings: {
      errors: result.checkErrors,
      warnings: result.checkWarnings,
    },
  };
}
