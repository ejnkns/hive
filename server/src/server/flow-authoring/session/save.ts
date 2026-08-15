/** @private — the one save implementation, shared by the save_definition tool
 * (the agent saves from chat) and the synchronous save route (the editor's
 * Save button): register the session's definition module as a definition —
 * create on the first save, update by savedDefinitionId afterwards. Only
 * flow-authoring/session.ts (re-export) and session/tools/save-definition.ts
 * import from here. */

import {
  analyzeFlowDefinition,
  parseDefinition,
  validateFlowDefinition,
} from "../../flow-definition.ts";
import {
  registerUserDefinition,
  updateUserDefinition,
} from "../../flow-definitions.ts";
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
      "Nothing to save — ask the agent to write a definition module first."
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
  const record = targetId
    ? await updateUserDefinition(targetId, {
        name,
        source,
        files: state.files,
      })
    : await registerUserDefinition({
        name,
        source,
        files: state.files,
      });

  // Non-blocking save findings: the definition validator's analysis of the
  // saved module (the load already validated + compiled — errors would have
  // thrown above; these are the advisory warnings).
  const { definition, findings } = parseDefinition(source);
  const warnings = [...analyzeFlowDefinition(definition), ...findings];
  const errors = validateFlowDefinition(definition).map(
    (e) => `${e.path}: ${e.message}`
  );
  return {
    id: record.id,
    name: record.name,
    checkErrors: errors,
    checkWarnings: warnings,
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
