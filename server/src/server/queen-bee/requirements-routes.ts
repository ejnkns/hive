/** @public — requirements session REST endpoints */

import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import type { FastifyInstance } from "fastify";
import { isRecord } from "shared/board-types";
import { getFlowRuntime } from "../flow-registry";
import { getProviders } from "../proxy/providers-state";

type SessionState = {
  sessionId: string;
  projectId: string;
  messages: Array<{ role: string; content: string }>;
  draftRequirements?: string;
  complete?: boolean;
};

const sessions = new Map<string, SessionState>();

export function registerRequirementsRoutes(server: FastifyInstance): void {
  server.get("/api/queen-bee/:projectId/phase", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const runtime = getFlowRuntime(projectId);
    if (!runtime) {
      return reply.status(404).send({ error: "Project not found" });
    }
    const instances = runtime.workflowInstancesInState();
    const reqInstance = instances.find(
      (i) =>
        i.workflowInstanceState &&
        (i.workflowInstanceState as any).projectId === projectId
    );
    if (!reqInstance) {
      return reply.send({ phase: "requirements", requirementsSession: null });
    }
    const state = reqInstance.currentState;
    if (
      state === "no_session" ||
      state === "drafting" ||
      state === "complete"
    ) {
      const session = sessions.get(projectId);
      return reply.send({
        phase: "requirements",
        requirementsSession: session
          ? {
              id: session.sessionId,
              messages: session.messages,
              status: session.complete ? "complete" : "active",
              draftRequirements: session.draftRequirements,
            }
          : null,
      });
    }
    if (state === "planning" || state === "planned") {
      return reply.send({ phase: "planning" });
    }
    if (state === "accepted") {
      return reply.send({ phase: "board" });
    }
    return reply.send({ phase: "requirements", requirementsSession: null });
  });

  server.post(
    "/api/queen-bee/:projectId/requirements/start",
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const body = isRecord(request.body) ? request.body : {};
      if (!body.prompt || typeof body.prompt !== "string") {
        return reply.status(400).send({ error: "prompt is required" });
      }

      const runtime = getFlowRuntime(projectId);
      if (!runtime) {
        return reply.status(404).send({ error: "Project not found" });
      }

      try {
        const sessionId = randomUUID();
        const config = runtime.getFlowConfig() as Record<string, unknown>;
        const repoPath = (config.repoPath as string) ?? "";
        const systemPrompt = `You are the Requirements Agent. Conduct a requirements elicitation interview that turns user intent into a concrete, precise project-wide requirements specification that a developer could implement without guessing.

## Your role

You are a requirements analyst, not an implementer or card planner. You explore the codebase to understand what currently exists — not to propose changes, write code, decompose work, or author Card Specifications. Your only outputs are clarifying questions and the Requirements Draft via \`update_requirements_draft\`.

## Interview rules

1. Ask ONE question at a time. Never ask multiple questions in one message.
2. Wait for the user's response before asking the next question.
3. Work BREADTH-FIRST. Before going deep on any single thread, explore the whole space.

## Keeping the requirements document up to date

Call \`update_requirements_draft\` FREQUENTLY — after every significant answer from the user. Pass the FULL document content each call.

## Signaling completion

When the requirements are concrete enough, write \`REQUIREMENTS_COMPLETE\` on its own line at the end of your response.

## Codebase exploration (MANDATORY first step)

Before you ask ANY question, explore the codebase thoroughly. You have tools to list directories, read files, and search code. Use them aggressively.

Only after you've exhausted what the codebase can tell you should you ask the user for clarification.`;

        // Find or create the requirements workflow instance
        const instances = runtime.workflowInstancesInState();
        const reqInstance = instances.find(
          (i) => (i.workflowInstanceState as any)?.projectId === projectId
        );

        // Build tools payload
        const tools = [
          {
            type: "function" as const,
            function: {
              name: "list_directory",
              description: "List files in a directory",
              parameters: {
                type: "object",
                properties: { path: { type: "string" } },
                required: ["path"],
              },
            },
          },
          {
            type: "function" as const,
            function: {
              name: "read_file",
              description: "Read a file",
              parameters: {
                type: "object",
                properties: { path: { type: "string" } },
                required: ["path"],
              },
            },
          },
          {
            type: "function" as const,
            function: {
              name: "search_code",
              description: "Search codebase",
              parameters: {
                type: "object",
                properties: { query: { type: "string" } },
                required: ["query"],
              },
            },
          },
          {
            type: "function" as const,
            function: {
              name: "update_requirements_draft",
              description:
                "Replace the session's proposed requirements draft. This never mutates the canonical requirements document.",
              parameters: {
                type: "object",
                properties: { content: { type: "string" } },
                required: ["content"],
              },
            },
          },
        ];

        const messages: Array<{ role: string; content: string }> = [
          { role: "system", content: systemPrompt },
          { role: "user", content: body.prompt },
        ];

        // Tool loop: execute tools and call model again until response is ready
        let result = await callModel(messages, repoPath, tools);
        for (let round = 0; round < 10; round++) {
          if (result.toolCalls.length === 0) break;

          const toolResults = await executeToolCalls(
            result.toolCalls,
            repoPath
          );

          messages.push({
            role: "assistant",
            content: result.content,
            reasoning_content: result.reasoningContent,
            tool_calls: result.toolCalls.map((tc) => ({
              id: tc.id,
              type: "function" as const,
              function: { name: tc.name, arguments: tc.arguments },
            })),
          } as any);
          for (const tr of toolResults) {
            messages.push(tr as any);
          }
          result = await callModel(messages, repoPath, tools);
        }

        const session: SessionState = {
          sessionId,
          projectId,
          messages: [
            { role: "user", content: body.prompt },
            { role: "assistant", content: result.content },
          ],
          draftRequirements: extractDraft(result),
        };

        sessions.set(projectId, session);

        if (result.content.includes("REQUIREMENTS_COMPLETE")) {
          session.complete = true;
        }

        return reply.send({
          sessionId,
          question: result.content,
          draftRequirements: session.draftRequirements,
          projectId,
        });
      } catch (err) {
        return reply.status(500).send({
          error:
            err instanceof Error ? err.message : "Requirements Session failed",
        });
      }
    }
  );

  server.post(
    "/api/queen-bee/:projectId/requirements/respond",
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const body = isRecord(request.body) ? request.body : {};
      if (!body.answer || typeof body.answer !== "string") {
        return reply.status(400).send({ error: "answer is required" });
      }

      const session = sessions.get(projectId);
      if (!session) {
        return reply.status(404).send({ error: "No active session" });
      }

      const runtime = getFlowRuntime(projectId);
      if (!runtime) {
        return reply.status(404).send({ error: "Project not found" });
      }

      try {
        const config = runtime.getFlowConfig() as Record<string, unknown>;
        const repoPath = (config.repoPath as string) ?? "";
        const systemPrompt = `You are the Requirements Agent. Conduct a requirements elicitation interview that turns user intent into a concrete, precise project-wide requirements specification that a developer could implement without guessing.

## Your role

You are a requirements analyst, not an implementer or card planner. You explore the codebase to understand what currently exists — not to propose changes, write code, decompose work, or author Card Specifications. Your only outputs are clarifying questions and the Requirements Draft via \`update_requirements_draft\`.

## Interview rules

1. Ask ONE question at a time. Never ask multiple questions in one message.
2. Wait for the user's response before asking the next question.
3. Work BREADTH-FIRST. Before going deep on any single thread, explore the whole space.

## Keeping the requirements document up to date

Call \`update_requirements_draft\` FREQUENTLY — after every significant answer from the user. Pass the FULL document content each call.

## Signaling completion

When the requirements are concrete enough, write \`REQUIREMENTS_COMPLETE\` on its own line at the end of your response.

## Codebase exploration (MANDATORY first step)

Before you ask ANY question, explore the codebase thoroughly. You have tools to list directories, read files, and search code. Use them aggressively.

Only after you've exhausted what the codebase can tell you should you ask the user for clarification.`;

        const tools = [
          {
            type: "function" as const,
            function: {
              name: "list_directory",
              description: "List files in a directory",
              parameters: {
                type: "object",
                properties: { path: { type: "string" } },
                required: ["path"],
              },
            },
          },
          {
            type: "function" as const,
            function: {
              name: "read_file",
              description: "Read a file",
              parameters: {
                type: "object",
                properties: { path: { type: "string" } },
                required: ["path"],
              },
            },
          },
          {
            type: "function" as const,
            function: {
              name: "search_code",
              description: "Search codebase",
              parameters: {
                type: "object",
                properties: { query: { type: "string" } },
                required: ["query"],
              },
            },
          },
          {
            type: "function" as const,
            function: {
              name: "update_requirements_draft",
              description:
                "Replace the session's proposed requirements draft. This never mutates the canonical requirements document.",
              parameters: {
                type: "object",
                properties: { content: { type: "string" } },
                required: ["content"],
              },
            },
          },
        ];

        const apiMessages: Array<{ role: string; content: string }> = [
          { role: "system", content: systemPrompt },
          ...session.messages.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
          { role: "user" as const, content: body.answer },
        ];

        session.messages.push({ role: "user", content: body.answer });

        // Tool loop
        let result = await callModel(apiMessages, repoPath, tools);
        const maxRounds = 10;
        for (let round = 0; round < maxRounds; round++) {
          if (result.toolCalls.length === 0) break;

          const toolResults = await executeToolCalls(
            result.toolCalls,
            repoPath
          );

          const assistantMsg = {
            role: "assistant",
            content: result.content,
            reasoning_content: result.reasoningContent,
            tool_calls: result.toolCalls.map((tc) => ({
              id: tc.id,
              type: "function",
              function: { name: tc.name, arguments: tc.arguments },
            })),
          };

          session.messages.push({ role: "assistant", content: result.content });
          apiMessages.push(assistantMsg);

          for (const tr of toolResults) {
            apiMessages.push({
              role: "tool",
              content: tr.content,
              tool_call_id: tr.tool_call_id,
            } as any);
            session.messages.push({
              role: "tool",
              content: `tool: ${tr.tool_call_id}`,
            });
          }

          result = await callModel(apiMessages, repoPath, tools);

          // Extract draft from tool results
          for (const toolCall of result.toolCalls) {
            if (toolCall.name === "update_requirements_draft") {
              try {
                const args = JSON.parse(toolCall.arguments);
                if (args.content) {
                  session.draftRequirements = args.content;
                }
              } catch {
                // ignore parse errors
              }
            }
          }
        }

        session.messages.push({
          role: "assistant",
          content: result.content,
        });

        if (result.content.includes("REQUIREMENTS_COMPLETE")) {
          session.complete = true;
          return reply.send({
            complete: true,
            spec: result.content,
            draftRequirements: session.draftRequirements,
          });
        }

        return reply.send({
          question: result.content,
          draftRequirements: session.draftRequirements,
        });
      } catch (err) {
        return reply.status(500).send({
          error:
            err instanceof Error ? err.message : "Requirements Session failed",
        });
      }
    }
  );

  server.delete(
    "/api/queen-bee/:projectId/requirements/session/:sessionId",
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      sessions.delete(projectId);
      return reply.send({ ok: true });
    }
  );
}

async function callModel(
  messages: Array<Record<string, unknown>>,
  _workspacePath: string,
  tools: Array<{ type: "function"; function: Record<string, unknown> }>
): Promise<{
  content: string;
  reasoningContent?: string;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
}> {
  const providers = getProviders();
  const provider = providers.find((p) => {
    const key = process.env[p.apiKeyEnvVar];
    return key && key.length > 0;
  });
  if (!provider) throw new Error("No configured providers available");

  const body = JSON.stringify({
    model: provider.defaultModel,
    messages,
    tools,
    stream: true,
  });

  const response = await fetch(provider.chatEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env[provider.apiKeyEnvVar] ?? ""}`,
    },
    body,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Provider returned ${response.status}`);
  }

  const text = await response.text();
  const passThrough = new PassThrough();
  passThrough.write(Buffer.from(text));
  passThrough.end();

  return consumeStream(passThrough);
}

function consumeStream(stream: NodeJS.ReadableStream): Promise<{
  content: string;
  reasoningContent?: string;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
}> {
  let content = "";
  let reasoningContent = "";
  let buffer = "";
  const toolCallsMap = new Map<
    number,
    { id: string; name: string; arguments: string }
  >();

  return new Promise((resolve, reject) => {
    stream.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data) as Record<string, unknown>;
          const choices = parsed.choices as
            | Array<Record<string, unknown>>
            | undefined;
          if (!choices?.[0]) continue;
          const delta = choices[0].delta as Record<string, unknown> | undefined;
          if (delta?.content && typeof delta.content === "string")
            content += delta.content;
          if (
            delta?.reasoning_content &&
            typeof delta.reasoning_content === "string"
          )
            reasoningContent += delta.reasoning_content;
          if (delta?.tool_calls && Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const tcr = tc as Record<string, unknown>;
              const index =
                typeof tcr.index === "number" ? tcr.index : undefined;
              if (index === undefined) continue;
              const existing = toolCallsMap.get(index);
              if (existing) {
                if (tcr.id && typeof tcr.id === "string") existing.id = tcr.id;
                const fn = tcr.function as Record<string, unknown> | undefined;
                if (fn?.name && typeof fn.name === "string")
                  existing.name = fn.name;
                if (fn?.arguments && typeof fn.arguments === "string")
                  existing.arguments += fn.arguments;
              } else {
                const fn = (tcr.function ?? {}) as Record<string, unknown>;
                toolCallsMap.set(index, {
                  id: typeof tcr.id === "string" ? tcr.id : "",
                  name: typeof fn.name === "string" ? fn.name : "",
                  arguments:
                    typeof fn.arguments === "string" ? fn.arguments : "",
                });
              }
            }
          }
        } catch {
          // skip malformed chunks
        }
      }
    });

    stream.on("end", () => {
      const toolCalls = Array.from(toolCallsMap.values()).map(
        (tc) =>
          ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          }) as { id: string; name: string; arguments: string }
      );
      resolve({
        content,
        reasoningContent: reasoningContent || undefined,
        toolCalls,
      });
    });

    stream.on("error", (err) => reject(err));
  });
}

async function executeToolCalls(
  toolCalls: Array<{ id: string; name: string; arguments: string }>,
  repoPath: string
): Promise<Array<{ role: "tool"; tool_call_id: string; content: string }>> {
  const results: Array<{
    role: "tool";
    tool_call_id: string;
    content: string;
  }> = [];
  for (const tc of toolCalls) {
    try {
      const args = JSON.parse(tc.arguments);
      if (tc.name === "list_directory") {
        const { readdirSync } = await import("node:fs");
        const { join } = await import("node:path");
        try {
          const files = readdirSync(
            args.path ? join(repoPath, args.path) : repoPath
          );
          results.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify(files),
          });
        } catch {
          results.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify({ error: "Directory not found" }),
          });
        }
      } else if (tc.name === "read_file") {
        const { readFileSync, existsSync } = await import("node:fs");
        const { join } = await import("node:path");
        const filePath = args.path ? join(repoPath, args.path) : repoPath;
        if (!existsSync(filePath)) {
          results.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify({ error: "File not found" }),
          });
        } else {
          results.push({
            role: "tool",
            tool_call_id: tc.id,
            content: readFileSync(filePath, "utf-8"),
          });
        }
      } else if (tc.name === "search_code") {
        const { execFileSync } = await import("node:child_process");
        try {
          const output = execFileSync(
            "grep",
            [
              "-r",
              "--include=*.ts",
              "--include=*.tsx",
              "--include=*.js",
              "-l",
              args.query,
              repoPath,
            ],
            { encoding: "utf-8", timeout: 5000 }
          );
          results.push({
            role: "tool",
            tool_call_id: tc.id,
            content: output || "No matches found",
          });
        } catch {
          results.push({
            role: "tool",
            tool_call_id: tc.id,
            content: "No matches found",
          });
        }
      } else if (tc.name === "update_requirements_draft") {
        results.push({
          role: "tool",
          tool_call_id: tc.id,
          content: "Draft updated",
        });
      } else {
        results.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({ error: `Unknown tool: ${tc.name}` }),
        });
      }
    } catch {
      results.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify({ error: "Failed to execute tool call" }),
      });
    }
  }
  return results;
}

function buildMessageLog(
  result: {
    content: string;
    toolCalls: Array<{ id: string; name: string; arguments: string }>;
  },
  _role: string
): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [];
  if (result.content) {
    messages.push({ role: "assistant", content: result.content });
  }
  for (const tc of result.toolCalls) {
    messages.push({
      role: "assistant",
      content: `tool: ${tc.name}(${tc.arguments})`,
    });
  }
  return messages;
}

function extractDraft(result: {
  content: string;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
}): string | undefined {
  for (const tc of result.toolCalls) {
    if (tc.name === "update_requirements_draft") {
      try {
        const args = JSON.parse(tc.arguments);
        if (args.content) return args.content;
      } catch {
        // ignore
      }
    }
  }
  return undefined;
}
