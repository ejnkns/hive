import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "honeycomb",
  label: "Honeycomb",
  description:
    "Paste raw idea notes in — the agent explores the repo to understand the domain, splits the notes into ideas, and classifies every idea (category + tags). No approval step; map.md builds automatically as imports land.",
  configSchema: [
    {
      key: "basePath",
      label: "Base path",
      type: "string",
      required: true,
      hint: "A directory (repo or scratch) to hold the flow's domain state — map.md lands under .honeycomb/.",
    },
  ],
  domainDir: ".honeycomb",
  // The shared published taxonomy lives in flowState (E2) — one place, never
  // duplicated onto the idea cards. Per-idea classifications are instance
  // data on the cards.
  flowState: [{ field: "taxonomy", type: "object" }],
  tools: [
    {
      id: "read_taxonomy",
      ref: "./tools/read-taxonomy.ts",
    },
  ],
  operations: [
    {
      id: "prepare_input",
      ref: "./imports/ops/prepare-input.ts",
      writes: ["digest"],
    },
    {
      id: "publish_taxonomy",
      ref: "./imports/ops/publish-taxonomy.ts",
    },
    {
      id: "build_map",
      ref: "./organize/ops/build-map.ts",
    },
    {
      id: "check_classification",
      ref: "./ideas/ops/check-classification.ts",
    },
  ],
  workflows: [
    {
      id: "imports",
      label: "Imports",
      description:
        "One instance per paste session: raw text in, classified idea cards out.",
      instance: { title: "name" },
      display: {
        fields: [{ path: "ideas", label: "Ideas", derive: { kind: "count" } }],
      },
      instanceState: [
        { field: "name", type: "string" },
        { field: "rawText", type: "string" },
        { field: "digest", type: "string" },
        { field: "ideas", type: "object[]" },
      ],
      initial: "raw",
      terminalStates: ["done"],
      states: [
        {
          id: "raw",
          label: "Raw",
          category: "initial",
          tasks: [
            {
              id: "prepareInput",
              label: "Prepare parse input",
              role: "operation",
              operations: ["prepare_input"],
            },
            {
              id: "parse",
              label: "Split and classify ideas",
              role: "ai-task",
              systemPromptRef: "./imports/prompts/parse.ts",
              inputFromInstanceState: "digest",
              // The file tools read the bound repo (the task's workspace is
              // the flow's basePath); read_taxonomy surfaces existing
              // categories so new ideas reuse them.
              tools: [
                "read_file",
                "list_directory",
                "search_code",
                "read_taxonomy",
              ],
              completionOutput: [
                {
                  field: "categories",
                  type: "object[]",
                  description:
                    "The category set every idea is classified against: each { name, definition }, 4-9 total, reusing existing taxonomy category names when they fit.",
                },
                {
                  field: "ideas",
                  type: "object[]",
                  description:
                    "Classified idea chunks, each { title, text, category, tags, priority, effort, status, summary } — category from the returned categories, tags 2-5 short tags.",
                },
              ],
              // The import preview renders the parsed chunks as compact cards:
              // title, summary, and the tags as bullets (items resolves
              // relative to the task output → output.ideas).
              render: {
                kind: "cards",
                props: {
                  items: "ideas",
                  title: "title",
                  description: "summary",
                  bullets: "tags",
                },
              },
            },
          ],
          autoTransitions: [
            {
              to: "parsed",
              gate: { kind: "taskSuccess", task: "parse" },
            },
            {
              to: "failed",
              gate: {
                kind: "or",
                gates: [
                  { kind: "taskError", task: "prepareInput" },
                  { kind: "taskError", task: "parse" },
                ],
              },
            },
          ],
        },
        {
          id: "parsed",
          label: "Parsed",
          category: "active",
          tasks: [
            {
              id: "recordIdeas",
              label: "Record parsed ideas",
              role: "operation",
              patch: {
                ideas: {
                  kind: "taskOutput",
                  task: "parse",
                  path: "output.ideas",
                },
              },
            },
            {
              id: "publishTaxonomy",
              label: "Publish taxonomy to flowState",
              role: "operation",
              operations: ["publish_taxonomy"],
            },
          ],
          // Auto-transitions evaluate after EACH task, so the leave gate must
          // wait for both tasks — the taxonomy has to be published before the
          // fan-out creates cards (they classify against it).
          autoTransitions: [
            {
              to: "done",
              gate: {
                kind: "and",
                gates: [
                  { kind: "taskSuccess", task: "recordIdeas" },
                  { kind: "taskSuccess", task: "publishTaxonomy" },
                ],
              },
            },
            {
              to: "failed",
              gate: {
                kind: "or",
                gates: [
                  { kind: "taskError", task: "recordIdeas" },
                  { kind: "taskError", task: "publishTaxonomy" },
                ],
              },
            },
          ],
        },
        { id: "done", label: "Done", category: "terminal" },
        {
          id: "failed",
          label: "Failed",
          category: "error",
          actions: [
            {
              id: "retry",
              label: "Retry parse",
              variant: "primary",
              transitionTo: "raw",
            },
            {
              id: "discard",
              label: "Discard",
              variant: "destructive",
              deletesInstance: true,
            },
          ],
        },
      ],
    },
    {
      id: "organize",
      label: "Map",
      description:
        "Builds map.md from the classified idea cards — one click, no AI.",
      instance: { title: "name" },
      instanceState: [{ field: "name", type: "string" }],
      initial: "building",
      terminalStates: ["done"],
      states: [
        {
          id: "building",
          label: "Building",
          category: "initial",
          tasks: [
            {
              id: "buildMap",
              label: "Build map.md",
              role: "operation",
              operations: ["build_map"],
              persist: { path: "map.md" },
              // The map string renders as markdown — operation outputs are
              // hidden by default, and this hint keeps the preview visible.
              render: { kind: "markdown" },
            },
          ],
          autoTransitions: [
            {
              to: "done",
              gate: { kind: "taskSuccess", task: "buildMap" },
            },
            {
              to: "failed",
              gate: { kind: "taskError", task: "buildMap" },
            },
          ],
        },
        {
          id: "done",
          label: "Done",
          category: "terminal",
          actions: [
            {
              id: "rebuild",
              label: "Rebuild map",
              variant: "primary",
              transitionTo: "building",
            },
          ],
        },
        {
          id: "failed",
          label: "Failed",
          category: "error",
          actions: [
            {
              id: "retry",
              label: "Retry",
              variant: "primary",
              transitionTo: "building",
            },
            {
              id: "discard",
              label: "Discard",
              variant: "destructive",
              deletesInstance: true,
            },
          ],
        },
      ],
    },
    {
      id: "ideas",
      label: "Ideas",
      description:
        "The board you live in: every idea card, classified, cross-referenced, editable in place.",
      instance: { title: "title", subtitle: "category" },
      ui: {
        // E3: the board partitions by the approved category — one column per
        // distinct value (plus Uncategorized). The engine never interprets the
        // values; cards move columns as the human edits category in place.
        groupByField: "category",
      },
      display: {
        fields: [
          { path: "summary", label: "Summary" },
          { path: "category", label: "Category" },
          { path: "priority", label: "Priority" },
          { path: "effort", label: "Effort" },
          { path: "status", label: "Status" },
          { path: "tags", label: "Tags", render: { kind: "chips" } },
        ],
      },
      editFields: [
        {
          key: "category",
          label: "Category",
          type: "string",
          // E4: the category select's options come from flowState's published
          // taxonomy (the AI's categories) — falls back to free text before
          // the taxonomy is published.
          optionsFrom: { flowState: "taxonomy.categoryNames" },
        },
        { key: "tags", label: "Tags", type: "string[]" },
        {
          key: "priority",
          label: "Priority",
          type: "string",
          options: ["p0", "p1", "p2", "p3", "p4"],
        },
        {
          key: "effort",
          label: "Effort",
          type: "string",
          options: ["S", "M", "L", "XL"],
        },
        {
          key: "status",
          label: "Status",
          type: "string",
          options: ["backlog", "in-progress", "blocked", "done", "parked"],
        },
      ],
      instanceState: [
        { field: "title", type: "string" },
        { field: "originalText", type: "string" },
        { field: "category", type: "string" },
        { field: "tags", type: "string[]" },
        { field: "priority", type: "string" },
        { field: "effort", type: "string" },
        { field: "status", type: "string" },
        { field: "summary", type: "string" },
      ],
      initial: "imported",
      terminalStates: ["done", "parked"],
      states: [
        {
          id: "imported",
          label: "Imported",
          category: "initial",
          tasks: [
            {
              id: "checkClassification",
              label: "Check classification",
              role: "operation",
              operations: ["check_classification"],
            },
          ],
          // A card the parse agent classified stays put; an uncategorized card
          // (import fallback or a manual add) routes to per-idea classify.
          autoTransitions: [
            {
              to: "classify",
              gate: { kind: "file", ref: "./gates/needs-classify.ts" },
            },
          ],
          actions: [
            {
              id: "discard",
              label: "Discard",
              variant: "destructive",
              deletesInstance: true,
            },
          ],
        },
        {
          id: "classify",
          label: "Classify",
          category: "active",
          tasks: [
            {
              id: "classify",
              label: "Classify this idea",
              role: "ai-task",
              systemPromptRef: "./ideas/prompts/classify.ts",
              inputFromInstanceState: "originalText",
              tools: ["read_taxonomy"],
              // Each classification renders as a compact card: category as the
              // title, the summary as the description, tags as bullets.
              render: {
                kind: "card",
                props: {
                  title: "category",
                  description: "summary",
                  bullets: "tags",
                },
              },
              completionOutput: [
                { field: "category", type: "string" },
                { field: "tags", type: "string[]" },
                { field: "priority", type: "string" },
                { field: "effort", type: "string" },
                { field: "status", type: "string" },
                { field: "summary", type: "string" },
              ],
            },
            {
              id: "recordClassification",
              label: "Record classification",
              role: "operation",
              patch: {
                category: {
                  kind: "taskOutput",
                  task: "classify",
                  path: "output.category",
                },
                tags: {
                  kind: "taskOutput",
                  task: "classify",
                  path: "output.tags",
                },
                priority: {
                  kind: "taskOutput",
                  task: "classify",
                  path: "output.priority",
                },
                effort: {
                  kind: "taskOutput",
                  task: "classify",
                  path: "output.effort",
                },
                status: {
                  kind: "taskOutput",
                  task: "classify",
                  path: "output.status",
                },
                summary: {
                  kind: "taskOutput",
                  task: "classify",
                  path: "output.summary",
                },
              },
            },
          ],
          autoTransitions: [
            {
              to: "classified",
              gate: {
                kind: "and",
                gates: [
                  { kind: "taskSuccess", task: "classify" },
                  { kind: "taskSuccess", task: "recordClassification" },
                ],
              },
            },
            {
              to: "failed",
              gate: { kind: "taskError", task: "classify" },
            },
          ],
          actions: [
            {
              id: "discard",
              label: "Discard",
              variant: "destructive",
              deletesInstance: true,
            },
          ],
        },
        {
          id: "classified",
          label: "Classified",
          category: "active",
          actions: [
            {
              id: "markDone",
              label: "Mark done",
              variant: "primary",
              transitionTo: "done",
            },
            {
              id: "park",
              label: "Park",
              variant: "secondary",
              transitionTo: "parked",
            },
            {
              id: "discard",
              label: "Discard",
              variant: "destructive",
              deletesInstance: true,
            },
          ],
        },
        {
          id: "failed",
          label: "Failed",
          category: "error",
          actions: [
            {
              id: "retry",
              label: "Retry classify",
              variant: "primary",
              transitionTo: "classify",
            },
            {
              id: "discard",
              label: "Discard",
              variant: "destructive",
              deletesInstance: true,
            },
          ],
        },
        { id: "done", label: "Done", category: "terminal" },
        { id: "parked", label: "Parked", category: "terminal" },
      ],
    },
  ],
  edges: [
    {
      // One idea card per parsed chunk, born with its parse classification —
      // the taxonomy is already published by the time this edge fires, so any
      // card that somehow lacks a category falls into per-idea classify.
      fromWorkflow: "imports",
      fromStates: ["done"],
      toWorkflow: "ideas",
      fanOut: {
        task: "parse",
        path: "output.ideas",
        fields: {
          title: { kind: "itemPath", path: "title" },
          originalText: { kind: "itemPath", path: "text" },
          category: { kind: "itemPath", path: "category" },
          tags: { kind: "itemPath", path: "tags" },
          priority: { kind: "itemPath", path: "priority" },
          effort: { kind: "itemPath", path: "effort" },
          status: { kind: "itemPath", path: "status" },
          summary: { kind: "itemPath", path: "summary" },
        },
      },
    },
    {
      // The map singleton: the first import creates it (seeded name "Map";
      // its initial buildMap auto-task runs) and every later import dispatches
      // the done-state Rebuild action — the map always reflects the latest
      // cards. Declared after the fan-out edge so the cards this rebuild
      // reads already exist when it fires.
      fromWorkflow: "imports",
      fromStates: ["done"],
      toWorkflow: "organize",
      autoDispatch: { actionId: "rebuild", createIfNone: true },
      fields: { name: { kind: "literal", value: "Map" } },
    },
  ],
  actions: [
    {
      id: "import_notes",
      label: "Import notes",
      variant: "primary",
      createInstance: {
        workflowId: "imports",
        fields: [
          {
            key: "name",
            label: "Name",
            type: "string",
            required: true,
            placeholder: "e.g. TODOs dump",
          },
          {
            key: "rawText",
            label: "Raw text",
            type: "textarea",
            required: true,
            placeholder: "Paste the raw dump here...",
          },
        ],
      },
    },
    {
      id: "add_idea",
      label: "Add idea",
      variant: "secondary",
      createInstance: {
        workflowId: "ideas",
        fields: [
          {
            key: "title",
            label: "Title",
            type: "string",
            required: true,
          },
          {
            key: "originalText",
            label: "Notes",
            type: "textarea",
            required: true,
          },
        ],
      },
    },
  ],
};
