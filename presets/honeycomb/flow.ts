import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "honeycomb",
  label: "Honeycomb",
  description:
    "Paste raw idea notes in, approve one taxonomy, and it organizes itself — categories, tags, priority, effort, dependencies, dedupe, and an organized map.md.",
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
  // The shared approved taxonomy lives in flowState (E2) — one place, never
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
      id: "assemble_backlog_digest",
      ref: "./organize/ops/assemble-backlog-digest.ts",
      writes: ["backlogDigest"],
    },
    {
      id: "publish_taxonomy",
      ref: "./organize/ops/publish-taxonomy.ts",
    },
    {
      id: "assemble_classify_input",
      ref: "./organize/ops/assemble-classify-input.ts",
      writes: ["classifyInput"],
    },
    {
      id: "apply_classifications",
      ref: "./organize/ops/apply-classifications.ts",
      // E1: the global classify pass writes each classification onto the
      // matching idea card's declared state, matched by title.
      writesAcross: [
        {
          workflow: "ideas",
          fields: [
            "category",
            "tags",
            "priority",
            "effort",
            "status",
            "dependsOn",
            "duplicateOf",
            "summary",
            "rationale",
            "dependents",
          ],
        },
      ],
    },
    {
      id: "build_map",
      ref: "./organize/ops/build-map.ts",
    },
    {
      id: "check_classification",
      ref: "./ideas/ops/check-classification.ts",
    },
    {
      id: "compute_dependents",
      ref: "./ideas/ops/compute-dependents.ts",
      writes: ["dependents"],
    },
  ],
  workflows: [
    {
      id: "imports",
      label: "Imports",
      description:
        "One instance per paste session: raw text in, one idea card per chunk out.",
      instance: { title: "name", subtitle: "source" },
      display: {
        fields: [
          { path: "source", label: "Source" },
          { path: "ideas", label: "Ideas", derive: { kind: "count" } },
        ],
      },
      instanceState: [
        { field: "name", type: "string" },
        { field: "source", type: "string" },
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
              label: "Split ideas",
              role: "ai-task",
              systemPromptRef: "./imports/prompts/parse.ts",
              inputFromInstanceState: "digest",
              completionOutput: [
                {
                  field: "ideas",
                  type: "object[]",
                  description:
                    "Split idea chunks, each { title, text, source } with the source copied from the input digest.",
                },
              ],
            },
          ],
          autoTransitions: [
            {
              to: "parsed",
              gate: { kind: "taskSuccess", task: "parse" },
            },
            {
              to: "failed",
              gate: { kind: "taskError", task: "parse" },
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
          ],
          autoTransitions: [
            {
              to: "done",
              gate: { kind: "taskSuccess", task: "recordIdeas" },
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
      label: "Organize",
      description:
        "The singleton brain: propose a taxonomy, get one approval, classify everything against it, build map.md.",
      instance: { title: "name" },
      display: {
        fields: [
          {
            path: "categories",
            label: "Proposed categories",
            derive: { kind: "count" },
          },
        ],
      },
      instanceState: [
        { field: "name", type: "string" },
        { field: "backlogDigest", type: "string" },
        { field: "categories", type: "object[]" },
        { field: "priorityScale", type: "object" },
        { field: "effortScale", type: "object" },
        { field: "dedupPolicy", type: "string" },
        { field: "classifyInput", type: "string" },
      ],
      initial: "preparing",
      terminalStates: ["done"],
      states: [
        {
          id: "preparing",
          label: "Preparing",
          category: "initial",
          tasks: [
            {
              id: "assembleDigest",
              label: "Assemble backlog digest",
              role: "operation",
              operations: ["assemble_backlog_digest"],
            },
          ],
          autoTransitions: [
            {
              to: "taxonomizing",
              gate: { kind: "taskSuccess", task: "assembleDigest" },
            },
            {
              to: "failed",
              gate: { kind: "taskError", task: "assembleDigest" },
            },
          ],
        },
        {
          id: "taxonomizing",
          label: "Taxonomizing",
          category: "active",
          tasks: [
            {
              id: "taxonomize",
              label: "Propose taxonomy",
              role: "ai-task",
              systemPromptRef: "./organize/prompts/taxonomize.ts",
              inputFromInstanceState: "backlogDigest",
              completionOutput: [
                {
                  field: "categories",
                  type: "object[]",
                  description:
                    "Proposed categories, each { name, definition }.",
                },
                {
                  field: "priorityScale",
                  type: "object",
                  description: "A small priority rubric.",
                },
                {
                  field: "effortScale",
                  type: "object",
                  description: "A small effort rubric.",
                },
                {
                  field: "dedupPolicy",
                  type: "string",
                  description: "How near-duplicates are recognized.",
                },
              ],
            },
            {
              id: "recordTaxonomy",
              label: "Record proposed taxonomy",
              role: "operation",
              patch: {
                categories: {
                  kind: "taskOutput",
                  task: "taxonomize",
                  path: "output.categories",
                },
                priorityScale: {
                  kind: "taskOutput",
                  task: "taxonomize",
                  path: "output.priorityScale",
                },
                effortScale: {
                  kind: "taskOutput",
                  task: "taxonomize",
                  path: "output.effortScale",
                },
                dedupPolicy: {
                  kind: "taskOutput",
                  task: "taxonomize",
                  path: "output.dedupPolicy",
                },
              },
            },
          ],
          autoTransitions: [
            {
              to: "taxonomy_proposed",
              gate: { kind: "taskSuccess", task: "taxonomize" },
            },
            {
              to: "failed",
              gate: { kind: "taskError", task: "taxonomize" },
            },
          ],
        },
        {
          id: "taxonomy_proposed",
          label: "Taxonomy proposed",
          category: "active",
          actions: [
            {
              id: "approve",
              label: "Approve taxonomy",
              variant: "primary",
              transitionTo: "publishing",
            },
            {
              id: "revise",
              label: "Revise taxonomy",
              variant: "secondary",
              transitionTo: "taxonomizing",
            },
          ],
        },
        {
          id: "publishing",
          label: "Publishing",
          category: "active",
          tasks: [
            {
              id: "publishTaxonomy",
              label: "Publish taxonomy to flowState",
              role: "operation",
              operations: ["publish_taxonomy"],
            },
          ],
          autoTransitions: [
            {
              to: "classifying",
              gate: { kind: "taskSuccess", task: "publishTaxonomy" },
            },
            {
              to: "failed",
              gate: { kind: "taskError", task: "publishTaxonomy" },
            },
          ],
        },
        {
          id: "classifying",
          label: "Classifying",
          category: "active",
          tasks: [
            {
              id: "assembleClassifyInput",
              label: "Assemble classify input",
              role: "operation",
              operations: ["assemble_classify_input"],
            },
            {
              id: "classifyAll",
              label: "Classify everything",
              role: "ai-task",
              systemPromptRef: "./organize/prompts/classify-all.ts",
              inputFromInstanceState: "classifyInput",
              completionOutput: [
                {
                  field: "classifications",
                  type: "object[]",
                  description:
                    "One entry per idea: { title, category, tags, priority, effort, status, dependsOn, duplicateOf, summary, rationale }.",
                },
              ],
            },
            {
              id: "applyClassifications",
              label: "Apply classifications",
              role: "operation",
              operations: ["apply_classifications"],
            },
          ],
          autoTransitions: [
            {
              to: "map_building",
              gate: {
                kind: "and",
                gates: [
                  { kind: "taskSuccess", task: "classifyAll" },
                  { kind: "taskSuccess", task: "applyClassifications" },
                ],
              },
            },
            {
              to: "failed",
              gate: {
                kind: "or",
                gates: [
                  { kind: "taskError", task: "classifyAll" },
                  { kind: "taskError", task: "applyClassifications" },
                ],
              },
            },
          ],
        },
        {
          id: "map_building",
          label: "Building map",
          category: "active",
          tasks: [
            {
              id: "buildMap",
              label: "Build map.md",
              role: "operation",
              operations: ["build_map"],
              persist: { path: "map.md" },
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
              id: "reclassify",
              label: "Re-classify",
              variant: "primary",
              transitionTo: "classifying",
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
              transitionTo: "preparing",
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
          { path: "tags", label: "Tags" },
          { path: "dependsOn", label: "Depends on" },
          { path: "dependents", label: "Dependents" },
          { path: "duplicateOf", label: "Duplicate of" },
        ],
      },
      editFields: [
        {
          key: "category",
          label: "Category",
          type: "string",
          // E4: the category select's options come from flowState's published
          // taxonomy (the AI's categories) — falls back to free text before
          // the taxonomy is approved.
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
        { field: "source", type: "string" },
        { field: "category", type: "string" },
        { field: "tags", type: "string[]" },
        { field: "priority", type: "string" },
        { field: "effort", type: "string" },
        { field: "status", type: "string" },
        { field: "dependsOn", type: "string[]" },
        { field: "duplicateOf", type: "string" },
        { field: "summary", type: "string" },
        { field: "rationale", type: "string" },
        { field: "dependents", type: "string[]" },
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
            {
              id: "computeDependents",
              label: "Compute dependents",
              role: "operation",
              operations: ["compute_dependents"],
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
      // One idea card per parsed chunk, preserving the original text and the
      // import's source (the parse agent echoes source from the input digest).
      fromWorkflow: "imports",
      fromStates: ["done"],
      toWorkflow: "ideas",
      fanOut: {
        task: "parse",
        path: "output.ideas",
        fields: {
          title: { kind: "itemPath", path: "title" },
          originalText: { kind: "itemPath", path: "text" },
          source: { kind: "itemPath", path: "source" },
        },
      },
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
            key: "source",
            label: "Source",
            type: "string",
            options: ["todos", "google-doc", "manual"],
            required: true,
            defaultValue: "todos",
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
          {
            key: "source",
            label: "Source",
            type: "string",
            options: ["todos", "google-doc", "manual"],
            defaultValue: "manual",
          },
        ],
      },
    },
    {
      id: "start_organizing",
      label: "Start organizing",
      variant: "primary",
      // The organize brain is a singleton: the action hides once one exists
      // (the gate reads workflowInstancesInState by workflow).
      gate: { kind: "file", ref: "./gates/organize-exists.ts" },
      createInstance: {
        workflowId: "organize",
        fields: [
          {
            key: "name",
            label: "Name",
            type: "string",
            defaultValue: "Organizer",
          },
        ],
      },
    },
  ],
};
