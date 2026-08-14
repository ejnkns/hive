/** The canonical scaffold for a new flow: the single minimal, warning-free
 * definition module both the new-flow editor and the authoring session start
 * from. The editor shows it as the editable Definition tab in the no-session
 * new-flow state; the author session seeds it as the initial source when the
 * session brings no definition of its own (so the agent's first
 * `read_definition_source` sees a valid draft, never an empty tab). It is a
 * scaffold, not an exemplar — patterns and shapes live in the skill
 * knowledge, not here. Keep it as small as the validator allows; the
 * invariant test (`session.test.ts`) asserts it validates with zero errors
 * AND zero warnings. */

export const FLOW_SCAFFOLD_SOURCE = `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "myFlow",
  label: "My Flow",
  description: "Describe what this flow does.",
  configSchema: [],
  workflows: [
    {
      id: "items",
      label: "Items",
      instance: { title: "title" },
      display: { fields: [{ path: "title", label: "Title" }] },
      instanceState: [{ field: "title", type: "string" }],
      initial: "new",
      terminalStates: ["done"],
      states: [
        { id: "new", label: "New", category: "initial" },
        { id: "done", label: "Done", category: "terminal" },
      ],
    },
  ],
  actions: [
    {
      id: "add_item",
      label: "Add an item",
      variant: "primary",
      createInstance: {
        workflowId: "items",
        fields: [
          { key: "title", label: "Title", type: "string", required: true },
        ],
      },
    },
  ],
  edges: [],
};
`;
