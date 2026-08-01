/** @public — one-shot TS flow-definition generation through the model caller path. */

import type { Readable } from "node:stream";
import { loadDefinitionFromSource } from "./flow-definitions";
import { handleChatCompletion } from "./proxy/handle-chat-completion";

const SYSTEM_PROMPT = `You write TypeScript flow definitions for the Hive workflow engine.

A definition is a plain module that exports a \`flow\` object. The flow has a
\`workflows\` array built with defineWorkflow(...), an optional \`configSchema\`
array for instance inputs, and an \`edges\` array. Use erasable-syntax
TypeScript only (no enums, no namespaces, no parameter properties — plain
objects, arrow functions, and type annotations only). Do not import anything
other than defineWorkflow from "workflow-engine/workflow-types".

Workflow shape: a declarative state machine. Each state has an id, a label, an
optional category ("initial" | "active" | "terminal" | "error"), optional
tasks, optional autoTransitions (with a gate function reading ctx.taskOutputs),
and optional actions (user-clickable buttons with a transitionTo and a variant
"primary" | "secondary" | "destructive" | "default").

Task roles: "operation" (deterministic, uses the built-in operations such as
prepare_worktree), "ai-task" (one-shot agent, optional completionTool), or
"ai-chat" (multi-turn session awaiting user input). Auto tasks run on entry;
gates receive { taskOutputs, hasRunningTask, ... } and must use optional
chaining on taskOutputs (e.g. ctx.taskOutputs.myTask?.status === "success").

configSchema entries: { key, label, type: "string" | "boolean" | "number",
required?, hint? }.

Return ONLY the complete TypeScript module, in a single fenced code block.`;

const TEMPLATE = `import { defineWorkflow } from "workflow-engine/workflow-types";

const wf = defineWorkflow({
  id: "my-workflow",
  label: "My Workflow",
  taskOutputs: {} as Record<string, never>,
  states: [
    { id: "idle", label: "Idle", category: "initial" },
    { id: "done", label: "Done", category: "terminal" },
  ],
  initial: "idle",
  terminalStates: ["done"],
});

export const flow = {
  id: "my-flow",
  label: "My Flow",
  configSchema: [
    { key: "title", label: "Title", type: "string", required: true },
  ],
  workflows: [wf],
  edges: [],
};
`;

export async function generateFlowDefinitionSource(
  prompt: string
): Promise<string> {
  const result = await handleChatCompletion(
    {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `${prompt}\n\nReference template:\n${TEMPLATE}`,
        },
      ],
      stream: true,
    },
    {},
    undefined
  );

  if (!result.success || !result.stream) {
    throw new Error(result.error ?? "Model call failed");
  }

  const content = await consumeStream(result.stream);
  const source = extractTsModule(content);
  if (!source) {
    throw new Error("The model did not return a TypeScript module");
  }

  // The editor hands the source to the user, so reject output that cannot even
  // be transpiled+loaded — a broken definition is a worse starting point than
  // an error message.
  await loadDefinitionFromSource("__generate__", source);
  return source;
}

function consumeStream(stream: Readable): Promise<string> {
  let content = "";
  let buffer = "";

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
          const delta = choices?.[0]?.delta as
            | Record<string, unknown>
            | undefined;
          if (delta?.content && typeof delta.content === "string") {
            content += delta.content;
          }
        } catch {
          // skip malformed chunks
        }
      }
    });

    stream.on("end", () => resolve(content));
    stream.on("error", reject);
  });
}

function extractTsModule(content: string): string | undefined {
  const fenced = content.match(
    /```(?:ts|typescript|js|javascript)\n([\s\S]*?)```/
  );
  if (fenced?.[1] !== undefined && fenced[1].trim() !== "") {
    return fenced[1].trim();
  }
  return content.trim() !== "" ? content.trim() : undefined;
}
