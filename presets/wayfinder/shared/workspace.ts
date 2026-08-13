// the isolated-workspace preparation shared by wayfinder ops.

import { homedir } from "node:os";
import { join } from "node:path";
import {
  type OperationContext,
  prepareIsolatedWorkspace,
  readFlowSettings,
} from "workflow-engine/runners";
import { readString } from "./read.ts";

// A repo-bound workspace is a git worktree on a feature branch when the flow
// declares the git identity (integrationBranch/branchPrefix); without one — a
// planning-only flow, or a repo-bound flow with no git config — it is a plain
// sandbox directory. Reads only flow config, so it accepts any workflow's
// typed context.
export function prepareWorkspace<TState extends Record<string, unknown>>(
  ctx: OperationContext<TState>
) {
  const settings = readFlowSettings(ctx.flowConfig());
  const workspacesBasePath =
    readString(ctx.flowConfig().workspacesBasePath) ??
    join(homedir(), ".hive", "workspaces");
  const gitReady =
    settings.basePath !== undefined &&
    settings.integrationBranch !== undefined &&
    settings.branchPrefix !== undefined;
  return prepareIsolatedWorkspace({
    basePath: gitReady ? settings.basePath : undefined,
    workspacesBasePath,
    integrationBranch: settings.integrationBranch,
    branchPrefix: settings.branchPrefix,
    projectId: ctx.workflowId,
    cardId: ctx.instanceId,
    attempt: 1,
  });
}
