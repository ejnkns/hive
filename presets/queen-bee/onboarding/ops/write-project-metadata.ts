// The onboarding workflow's write_project_metadata operation, referenced by the
// queen-bee blueprint.

import {
  defineOperations,
  type OperationContext,
  resolveBasePath,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import type { OnboardingState } from "../types.ts";

type OperationResult = Record<string, unknown>;

function writeProjectMetadata(
  _task: TaskDefinition,
  _params: Record<string, unknown>,
  ctx: OperationContext<OnboardingState>
): OperationResult {
  const config = ctx.flowConfig();
  const basePath = resolveBasePath(ctx.flowConfig());
  const name =
    typeof config.name === "string"
      ? config.name
      : (basePath.split("/").pop() ?? basePath);
  const targetBranch =
    typeof config.targetBranch === "string" ? config.targetBranch : "main";
  return { name, basePath, targetBranch };
}

export const write_project_metadataOperations =
  defineOperations<OnboardingState>({
    write_project_metadata: writeProjectMetadata,
  });
