// The organize workflow's assemble_backlog_digest operation, referenced by
// the honeycomb flow definition.

import {
  defineOperations,
  type OperationContext,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import type { OrganizeState } from "../types.ts";

// Assembles the backlog digest: every import session (with its parsed ideas)
// and every idea card, as JSON. The taxonomize task seeds from it. Uses the
// cross-instance query filtered by workflow (E6).
export const assemble_backlog_digestOperations =
  defineOperations<OrganizeState>({
    assemble_backlog_digest: (
      _task: TaskDefinition,
      _params: Record<string, unknown>,
      ctx: OperationContext<OrganizeState>
    ) => {
      const imports = ctx.workflowInstancesInState("imports");
      const ideas = ctx.workflowInstancesInState("ideas");
      const importSessions = imports.map((i) => ({
        name: i.workflowInstanceState.name,
        source: i.workflowInstanceState.source,
        rawText: i.workflowInstanceState.rawText,
        parsed: i.workflowInstanceState.ideas,
      }));
      const ideaList = ideas.map((i) => ({
        title: i.workflowInstanceState.title,
        originalText: i.workflowInstanceState.originalText,
        source: i.workflowInstanceState.source,
        category: i.workflowInstanceState.category,
      }));
      const digest = JSON.stringify(
        { imports: importSessions, ideas: ideaList },
        null,
        2
      );
      ctx.patchWorkflowInstanceState({ backlogDigest: digest });
      return {
        ok: true,
        importSessions: importSessions.length,
        ideas: ideas.length,
      };
    },
  });
