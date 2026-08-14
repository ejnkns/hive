/** @private — the session workflow: a hidden built-in flow whose single
 * workflow instance is a live authoring conversation. One drafting state whose
 * ai-chat agent maintains the blueprint and runs the gate through the
 * authoring tools; the session never ends on its own. Only
 * flow-authoring/session.ts imports this. */

import {
  type CompiledFlowDefinition,
  defineWorkflow,
} from "workflow-engine/workflow-types";
import { buildAuthoringSessionPrompt } from "../session-prompt.ts";
import { AUTHORING_DEFINITION_ID, type AuthoringItemState } from "./state.ts";
import { authoringTools } from "./tools.ts";

const sessionWorkflow = defineWorkflow({
  id: "session",
  label: "Authoring session",
  instance: { title: "prompt" },
  // There is only ever one session instance — a board with 300px columns
  // would cramp the chat and preview. A flat list renders one full-width
  // card carrying its state; the instance component (flow-editor) renders
  // the session as the editor: header, chat, tokenized preview, actions.
  ui: { view: "list", instanceComponent: "flow-editor" },
  display: {
    fields: [{ path: "prompt", label: "Request" }],
  },
  taskOutputs: {} as Record<string, never>,
  workflowInstanceState: {} as AuthoringItemState,
  states: [
    {
      id: "drafting",
      label: "Drafting",
      category: "initial",
      // Saving is a flow capability: the agent calls the save_definition tool
      // on request, and the editor's Save button reaches the same core
      // synchronously through a thin route. No ManualActions — the session
      // has no transitions.
      tasks: [
        {
          id: "assistant",
          label: "Authoring assistant",
          role: "ai-chat",
          trigger: "auto",
          // The session stays interactive for its whole life — the agent can
          // generate, fail the gate, fix, and regenerate while the user keeps
          // chatting; it ends only when the user closes it or leaves.
          startOnUserInput: true,
          systemPrompt: buildAuthoringSessionPrompt(),
          tools: [
            "read_authoring_knowledge",
            "set_flow_blueprint",
            "generate_definition",
            "save_definition",
            "read_definition_source",
            "read_definition_file",
            "write_definition_file",
          ],
        },
      ],
    },
  ],
  initial: "drafting",
  terminalStates: [],
});

export const authoringSessionFlow = {
  id: AUTHORING_DEFINITION_ID,
  label: "Flow Authoring Session",
  description:
    "A live conversation that designs a Hive flow definition, maintaining the blueprint draft as decisions are made.",
  configSchema: [],
  workflows: [sessionWorkflow],
  tools: authoringTools,
  actions: [],
  edges: [],
} satisfies CompiledFlowDefinition;
