// The organize workflow's assemble_classify_input operation, referenced by
// the honeycomb flow definition.

import {
  defineOperations,
  type OperationContext,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import type { OrganizeState } from "../types.ts";

// Assembles the classify-all input: the approved taxonomy (read from flowState
// — E2) plus every idea card, as JSON. The classifyAll task seeds from it.
export const assemble_classify_inputOperations =
  defineOperations<OrganizeState>({
    assemble_classify_input: (
      _task: TaskDefinition,
      _params: Record<string, unknown>,
      ctx: OperationContext<OrganizeState>
    ) => {
      const taxonomy = ctx.flowState().taxonomy;
      const ideas = ctx.workflowInstancesInState("ideas");
      const input = JSON.stringify(
        {
          taxonomy,
          ideas: ideas.map((i) => ({
            title: i.workflowInstanceState.title,
            originalText: i.workflowInstanceState.originalText,
            source: i.workflowInstanceState.source,
          })),
        },
        null,
        2
      );
      ctx.patchWorkflowInstanceState({ classifyInput: input });
      return { ok: true, ideas: ideas.length };
    },
  });
