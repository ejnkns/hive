import type { Tool } from "workflow-engine/runners";
import { writeDraft } from "./domain-state";

// === QUEEN BEE DOMAIN TOOLS ===
//
// Self-contained tool bundles (schema + executor) for the queen-bee preset.
// The engine never interprets what these mean — it offers the schema and
// invokes the executor. The composition root merges them with the engine's
// infrastructure registry.

export const queenBeeTools: Tool[] = [
  {
    definition: {
      type: "function",
      function: {
        name: "submit_work",
        description:
          "Submit committed work to the deterministic Completion Gate. This must be the only tool call in the response.",
        parameters: {
          type: "object",
          properties: {
            outcome: {
              type: "string",
              description: "Either 'implemented' or 'already_satisfied'.",
            },
            verificationCallIds: {
              type: "array",
              description:
                "Successful run_command tool call IDs that verified the current commit.",
              items: { type: "string" },
            },
            verificationNotRunReason: { type: "string" },
            noChangeRationale: { type: "string" },
          },
          required: ["outcome"],
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
          "Submit the terminal structured review. This must be the only tool call in the response.",
        parameters: {
          type: "object",
          properties: {
            verdict: {
              type: "string",
              enum: ["approved", "changes_requested"],
            },
            recommendedApproach: {
              type: "string",
              enum: ["update", "new"],
            },
            findings: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  severity: { type: "string", enum: ["blocking", "warning"] },
                  requirement: { type: "string" },
                  evidence: { type: "string" },
                  recommendation: { type: "string" },
                },
                required: [
                  "severity",
                  "requirement",
                  "evidence",
                  "recommendation",
                ],
              },
            },
            verificationAssessment: {
              type: "object",
              properties: {
                status: {
                  type: "string",
                  enum: ["sufficient", "insufficient"],
                },
                notes: { type: "string" },
              },
              required: ["status", "notes"],
            },
          },
          required: ["verdict", "findings", "verificationAssessment"],
        },
      },
    },
    executor: async (call) => ({
      toolCallId: call.id,
      content: "Review submitted",
      isError: false,
    }),
  },
  {
    definition: {
      type: "function",
      function: {
        name: "update_requirements_draft",
        description:
          "Replace the session's proposed requirements draft. This never mutates the canonical requirements document.",
        parameters: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "The full requirements document in markdown format.",
            },
          },
          required: ["content"],
        },
      },
    },
    executor: async (call, ctx) => {
      const args = JSON.parse(call.arguments) as { content?: string };
      if (typeof args.content !== "string") {
        return {
          toolCallId: call.id,
          content: "content is required",
          isError: true,
        };
      }
      const basePath = ctx.basePath ?? ctx.workspacePath;
      writeDraft(basePath, args.content);
      return {
        toolCallId: call.id,
        content: "Requirements draft updated",
        isError: false,
      };
    },
  },
];
