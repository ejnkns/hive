import type { Tool } from "workflow-engine/runners";
import { recordCardEvent, writeDraft } from "./domain-state";

// === QUEEN BEE DOMAIN TOOLS ===
//
// Self-contained tool bundles (schema + executor) for the queen-bee preset.
// The engine never interprets what these mean — it offers the schema and
// invokes the executor. The composition root merges them with the engine's
// infrastructure registry.

function eventTarget(callId: string, basePath?: string, instanceId?: string) {
  const cardId = instanceId ?? "";
  return {
    record: (type: string, data: Record<string, unknown>) => {
      if (!basePath || !cardId) return;
      recordCardEvent(basePath, cardId, {
        type,
        at: new Date().toISOString(),
        data,
      });
    },
    toolCallId: callId,
  };
}

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
    executor: async (call, ctx) => {
      const target = eventTarget(call.id, ctx.basePath, ctx.instanceId);
      try {
        const args = JSON.parse(call.arguments) as Record<string, unknown>;
        target.record("submitted", { outcome: args.outcome });
      } catch {
        // malformed args — still acknowledge the submission signal
      }
      return {
        toolCallId: target.toolCallId,
        content: "Work submitted for review",
        isError: false,
      };
    },
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
    executor: async (call, ctx) => {
      const target = eventTarget(call.id, ctx.basePath, ctx.instanceId);
      try {
        const args = JSON.parse(call.arguments) as Record<string, unknown>;
        target.record("reviewed", {
          verdict: args.verdict,
          recommendedApproach: args.recommendedApproach,
        });
      } catch {
        // malformed args — still acknowledge the review signal
      }
      return {
        toolCallId: target.toolCallId,
        content: "Review submitted",
        isError: false,
      };
    },
  },
  {
    definition: {
      type: "function",
      function: {
        name: "submit_plan",
        description:
          "Submit the terminal planning proposal or feedback. This must be the only tool call in the response.",
        parameters: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: ["proposal", "feedback"],
            },
            guidance: {
              type: "string",
              description:
                "Required when kind is feedback: what to revise and why.",
            },
            cards: {
              type: "array",
              description:
                "Required when kind is proposal: the cards to create.",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  description: { type: "string" },
                  acceptanceCriteria: {
                    type: "array",
                    items: { type: "string" },
                  },
                  dependencies: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
                required: ["title", "description", "acceptanceCriteria"],
              },
            },
          },
          required: ["kind"],
        },
      },
    },
    executor: async (call) => ({
      toolCallId: call.id,
      content: "Plan submitted",
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
