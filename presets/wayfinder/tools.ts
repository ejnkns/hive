import type { Tool } from "workflow-engine/runners";

// === WAYFINDER DOMAIN TOOLS ===
//
// Self-contained tool bundles (schema + executor) for the wayfinder preset.
// The engine never interprets their meaning — it offers the schema and invokes
// the executor. Completion tools (submit_resolution, submit_findings,
// submit_build_plan, submit_work, submit_review) are pure signals: their
// effects live in the parsed tool arguments, which the engine records as the
// task output. Recording tools (submit_map, submit_spec) patch the instance's
// domain state so a later operation can assemble the persisted document.

export const wayfinderTools: Tool[] = [
  {
    definition: {
      type: "function",
      function: {
        name: "submit_map",
        description:
          "Record the settled charting destination and notes for this effort. Called once the human confirms the destination is sharp; a later task persists the map.",
        parameters: {
          type: "object",
          properties: {
            destination: {
              type: "string",
              description: "The effort's settled destination, stated sharply.",
            },
            notes: {
              type: "string",
              description:
                "Standing notes on the effort, domain, or constraints.",
            },
          },
          required: ["destination"],
        },
      },
    },
    executor: async (call, ctx) => {
      const args = JSON.parse(call.arguments) as {
        destination?: unknown;
        notes?: unknown;
      };
      const patch: Record<string, unknown> = {};
      if (typeof args.destination === "string") {
        patch.destination = args.destination;
      }
      if (typeof args.notes === "string") {
        patch.notes = args.notes;
      }
      ctx.patchWorkflowInstanceState?.(patch);
      return {
        toolCallId: call.id,
        content: "Map recorded",
        isError: false,
      };
    },
  },
  {
    definition: {
      type: "function",
      function: {
        name: "submit_resolution",
        description:
          "Submit the terminal resolution of this decision ticket: the decision reached and a short gist. For a prototype, link the artifact path in the workspace. This must be the only tool call in the response.",
        parameters: {
          type: "object",
          properties: {
            decision: {
              type: "string",
              description: "The decision reached, stated sharply.",
            },
            gist: {
              type: "string",
              description:
                "A one-to-two sentence summary of the shared understanding.",
            },
            artifactPath: {
              type: "string",
              description:
                "Relative path of a throwaway artifact (prototype) kept as a primary source.",
            },
          },
          required: ["decision", "gist"],
        },
      },
    },
    executor: async (call, ctx) => {
      const args = JSON.parse(call.arguments) as {
        decision?: unknown;
        gist?: unknown;
        artifactPath?: unknown;
      };
      const patch: Record<string, unknown> = {};
      if (typeof args.decision === "string") {
        patch.decision = args.decision;
      }
      if (typeof args.gist === "string") {
        patch.gist = args.gist;
      }
      if (typeof args.artifactPath === "string") {
        patch.artifactPath = args.artifactPath;
      }
      ctx.patchWorkflowInstanceState?.({ resolution: patch });
      return {
        toolCallId: call.id,
        content: "Resolution submitted",
        isError: false,
      };
    },
  },
  {
    definition: {
      type: "function",
      function: {
        name: "submit_findings",
        description:
          "Submit the terminal research findings: the question, the one cited markdown report, and the primary sources. This must be the only tool call in the response.",
        parameters: {
          type: "object",
          properties: {
            question: { type: "string" },
            findings: {
              type: "string",
              description: "The cited research report in markdown.",
            },
            sources: {
              type: "array",
              description: "Primary-source URLs consulted.",
              items: { type: "string" },
            },
          },
          required: ["question", "findings", "sources"],
        },
      },
    },
    executor: async (call) => ({
      toolCallId: call.id,
      content: "Findings submitted",
      isError: false,
    }),
  },
  {
    definition: {
      type: "function",
      function: {
        name: "submit_spec",
        description:
          "Record the drafted spec for the build phase. It becomes the input the planner reads; nothing is persisted until the human presses Done.",
        parameters: {
          type: "object",
          properties: {
            spec: {
              type: "string",
              description:
                "The full spec in markdown: problem, solution, user stories, decisions, testing, out of scope, seams.",
            },
            seams: {
              type: "array",
              description:
                "The agreed deep-module seams the build tickets will target.",
              items: { type: "string" },
            },
          },
          required: ["spec"],
        },
      },
    },
    executor: async (call, ctx) => {
      const args = JSON.parse(call.arguments) as {
        spec?: unknown;
        seams?: unknown;
      };
      const patch: Record<string, unknown> = {};
      if (typeof args.spec === "string") {
        patch.spec = args.spec;
      }
      if (Array.isArray(args.seams)) {
        patch.seams = args.seams.filter(
          (entry): entry is string => typeof entry === "string"
        );
      }
      ctx.patchWorkflowInstanceState?.(patch);
      return {
        toolCallId: call.id,
        content: "Spec recorded",
        isError: false,
      };
    },
  },
  {
    definition: {
      type: "function",
      function: {
        name: "submit_build_plan",
        description:
          "Submit the terminal build plan: the tracer-bullet build tickets with their blocking edges, ordered prefactoring-first and blockers-first. This must be the only tool call in the response.",
        parameters: {
          type: "object",
          properties: {
            tickets: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  description: { type: "string" },
                  acceptanceCriteria: {
                    type: "array",
                    items: { type: "string" },
                  },
                  dependsOn: {
                    type: "array",
                    description:
                      "Titles of other build tickets this one blocks on.",
                    items: { type: "string" },
                  },
                },
                required: ["title", "description", "acceptanceCriteria"],
              },
            },
          },
          required: ["tickets"],
        },
      },
    },
    executor: async (call) => ({
      toolCallId: call.id,
      content: "Build plan submitted",
      isError: false,
    }),
  },
  {
    definition: {
      type: "function",
      function: {
        name: "submit_work",
        description:
          "Submit the build ticket's work. Call when the ticket is implemented and verified in the workspace. This must be the only tool call in the response.",
        parameters: {
          type: "object",
          properties: {
            outcome: {
              type: "string",
              enum: ["implemented", "blocked"],
            },
            summary: {
              type: "string",
              description:
                "A short summary of what was done and how it was verified.",
            },
          },
          required: ["outcome", "summary"],
        },
      },
    },
    executor: async (call) => ({
      toolCallId: call.id,
      content: "Work submitted for review",
      isError: false,
    }),
  },
  {
    definition: {
      type: "function",
      function: {
        name: "submit_review",
        description:
          "Submit the terminal two-axis review: verdict plus separate Standards and Spec findings. This must be the only tool call in the response.",
        parameters: {
          type: "object",
          properties: {
            verdict: {
              type: "string",
              enum: ["approved", "changes_requested"],
            },
            findings: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  axis: { type: "string", enum: ["standards", "spec"] },
                  severity: { type: "string", enum: ["blocking", "warning"] },
                  detail: { type: "string" },
                  evidence: { type: "string" },
                },
                required: ["axis", "severity", "detail"],
              },
            },
          },
          required: ["verdict", "findings"],
        },
      },
    },
    executor: async (call) => ({
      toolCallId: call.id,
      content: "Review submitted",
      isError: false,
    }),
  },
];
