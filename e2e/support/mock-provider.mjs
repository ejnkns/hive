import assert from "node:assert/strict";
import { createServer } from "node:http";

export async function startMockProvider() {
  const failures = [];
  const requests = [];
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      sendJson(response, 200, { data: [{ id: "hive-e2e" }] });
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      sendJson(response, 404, { error: "Unknown mock-provider route" });
      return;
    }

    try {
      const payload = JSON.parse(await readBody(request));
      requests.push(payload);
      sendCompletion(response, completionFor(payload));
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  await listen(server);
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    failures,
    host: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => close(server),
  };
}

function completionFor(payload) {
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  if (
    messages.length === 1 &&
    messages[0]?.role === "user" &&
    messages[0]?.content === "ok"
  ) {
    return textCompletion("ok");
  }
  const systemText = messages
    .filter((message) => message.role === "system")
    .map((message) => String(message.content))
    .join("\n");
  if (systemText.includes("You are the Requirements Agent")) {
    return requirementsCompletion(messages);
  }
  if (systemText.includes("You are the Research Agent")) {
    return researchAgentCompletion(messages);
  }
  if (systemText.includes("You are an AI flow-design assistant")) {
    return authoringCompletion(messages);
  }
  if (systemText.includes("You are the Planner Agent")) {
    return plannerCompletion(messages);
  }
  if (
    systemText.includes(
      "You are an AI software engineer implementing a single feature"
    )
  ) {
    return workerCompletion(messages);
  }
  if (systemText.includes("You are the Reviewer Agent")) {
    return reviewerCompletion(messages);
  }
  throw new Error("Mock provider received an unknown Agent Role");
}

// The flow-authoring session: set_flow_blueprint lands the live preview,
// generate_definition runs the real engine gate and writes the source. Later
// turns cover co-editing: the divergence gate refuses set_flow_blueprint while the
// source is manual (the agent then proposes in chat), and after the user
// discards, the next ask regenerates.
function authoringCompletion(messages) {
  const firstUser = messages.find((message) => message.role === "user");
  const prompt =
    typeof firstUser?.content === "string" ? firstUser.content : "";
  if (/research loop/.test(prompt)) {
    return researchLoopCompletion(messages);
  }
  const toolMessages = messages.filter((message) => message.role === "tool");
  const lastMessage = messages.at(-1);
  if (toolMessages.length === 0) {
    return toolCompletion(
      [
        toolCall("author-blueprint", "set_flow_blueprint", {
          blueprint: JSON.stringify(AUTHORING_SPEC),
        }),
      ],
      "mock authoring reasoning"
    );
  }
  if (
    lastMessage?.tool_call_id?.startsWith("author-blueprint") &&
    !lastMessage.content.includes("manual edits")
  ) {
    // set_flow_blueprint succeeded (or the divergence was discarded) — generate.
    return toolCompletion(
      [
        toolCall("author-gen", "generate_definition", {
          blueprint: JSON.stringify(AUTHORING_SPEC),
        }),
      ],
      "mock authoring reasoning"
    );
  }
  if (lastMessage?.tool_call_id?.startsWith("author-gen")) {
    return textCompletion(
      "The definition is ready — summarize it for the user."
    );
  }
  if (
    lastMessage?.role === "tool" &&
    lastMessage.content.includes("manual edits")
  ) {
    // The divergence gate refused the blueprint update — propose in chat instead.
    return textCompletion(
      "I see you edited the definition by hand, so the blueprint is frozen. I'd suggest adding a reject action with a confirm; apply it yourself or discard your edits so I can take over."
    );
  }
  if (lastMessage?.role === "user") {
    return toolCompletion(
      [
        toolCall("author-blueprint", "set_flow_blueprint", {
          blueprint: JSON.stringify(AUTHORING_SPEC),
        }),
      ],
      "mock authoring reasoning"
    );
  }
  return textCompletion("The definition is ready.");
}

function requirementsCompletion(messages) {
  const toolMessages = messages.filter((message) => message.role === "tool");
  const lastMessage = messages.at(-1);
  if (toolMessages.length === 0 && countRole(messages, "assistant") === 0) {
    return toolCompletion(
      [
        toolCall("requirements-list", "list_directory", { path: "." }),
        toolCall("requirements-read", "read_file", {
          path: "src/app.ts",
        }),
      ],
      "mock requirements reasoning"
    );
  }
  if (lastMessage?.tool_call_id === "requirements-read") {
    assertAssistantTurn(messages, "mock requirements reasoning", 2);
    return textCompletion(
      "Should the initial feature display a deterministic greeting?"
    );
  }
  if (lastMessage?.role === "user") {
    return toolCompletion([
      toolCall("requirements-draft", "update_requirements_draft", {
        content: APPROVED_REQUIREMENTS,
      }),
    ]);
  }
  if (lastMessage?.tool_call_id === "requirements-draft") {
    return textCompletion(
      "REQUIREMENTS_COMPLETE\nThe draft is ready for independent planning."
    );
  }
  throw new Error("Unexpected Requirements Agent conversation state");
}

function plannerCompletion(messages) {
  const lastMessage = messages.at(-1);
  if (!messages.some((message) => message.role === "tool")) {
    return toolCompletion(
      [
        toolCall("planner-list", "list_directory", { path: "." }),
        toolCall("planner-read", "read_file", { path: "src/app.ts" }),
      ],
      "mock planner reasoning"
    );
  }
  if (lastMessage?.tool_call_id === "planner-read") {
    assertAssistantTurn(messages, "mock planner reasoning", 2);
    // The plan task completes via the submit_plan completion tool; its parsed
    // arguments become the task output the Accept-proposal gate reads.
    return toolCompletion([
      toolCall("planner-submit", "submit_plan", {
        kind: "proposal",
        cards: [
          {
            title: "Render deterministic greeting",
            description:
              "Render the approved greeting from the application entry point.",
            acceptanceCriteria: [
              "Running the application displays Hello from Hive",
            ],
            dependencies: [],
            requirementRefs: ["FR-1", "AC-1"],
          },
        ],
      }),
    ]);
  }
  throw new Error("Unexpected Planner Agent conversation state");
}

function workerCompletion(messages) {
  const lastMessage = messages.at(-1);
  if (!messages.some((message) => message.role === "tool")) {
    return toolCompletion(
      [
        toolCall("worker-read", "read_file", { path: "src/app.ts" }),
        toolCall("worker-status", "git_status", {}),
      ],
      "mock worker reasoning"
    );
  }
  if (lastMessage?.tool_call_id === "worker-status") {
    assertAssistantTurn(messages, "mock worker reasoning", 2);
    return toolCompletion([
      toolCall("worker-write", "write_file", {
        path: "src/app.ts",
        content: 'export const greeting = "Hello from Hive";\n',
      }),
    ]);
  }
  if (lastMessage?.tool_call_id === "worker-write") {
    return toolCompletion([
      toolCall("worker-commit", "commit_work", {
        message: "app: render deterministic greeting",
        paths: ["src/app.ts"],
      }),
    ]);
  }
  if (lastMessage?.tool_call_id === "worker-commit") {
    return toolCompletion([
      toolCall("worker-submit", "submit_work", {
        outcome: "implemented",
        verificationNotRunReason:
          "The fixture has no executable test runner; the Reviewer inspects the committed value.",
      }),
    ]);
  }
  throw new Error("Unexpected Worker Agent conversation state");
}

function reviewerCompletion(messages) {
  const lastMessage = messages.at(-1);
  if (!messages.some((message) => message.role === "tool")) {
    return toolCompletion(
      [
        toolCall("reviewer-read", "read_file", { path: "src/app.ts" }),
        toolCall("reviewer-log", "git_log", {}),
      ],
      "mock reviewer reasoning"
    );
  }
  if (lastMessage?.tool_call_id === "reviewer-log") {
    assertAssistantTurn(messages, "mock reviewer reasoning", 2);
    return toolCompletion([
      toolCall("reviewer-submit", "submit_review", {
        verdict: "approved",
        findings: [],
        verificationAssessment: {
          status: "sufficient",
          notes:
            "The committed source exactly matches the deterministic requirement.",
        },
      }),
    ]);
  }
  throw new Error("Unexpected Reviewer Agent conversation state");
}

function assertAssistantTurn(messages, _reasoningContent, toolCallCount) {
  // The runner persists assistant tool_calls in the conversation (reasoning
  // content is transient, not part of the wire contract). Verify the previous
  // turn's tool calls survived so the tool results can link to them.
  const assistant = [...messages]
    .reverse()
    .find(
      (message) =>
        message.role === "assistant" &&
        (message.tool_calls ?? []).length === toolCallCount
    );
  assert.ok(assistant, "one assistant turn must preserve every tool call");
}

function countRole(messages, role) {
  return messages.filter((message) => message.role === role).length;
}

function toolCall(id, name, args) {
  return {
    index: 0,
    id,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}

function toolCompletion(calls, reasoningContent) {
  return {
    choices: [
      {
        delta: {
          ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
          tool_calls: calls.map((call, index) => ({ ...call, index })),
        },
        finish_reason: "tool_calls",
      },
    ],
  };
}

function textCompletion(content) {
  return {
    choices: [{ delta: { content }, finish_reason: "stop" }],
  };
}

function sendCompletion(response, completion) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  response.write(`data: ${JSON.stringify(completion)}\n\n`);
  response.end("data: [DONE]\n\n");
}

function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) body += String(chunk);
  return body;
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

async function close(server) {
  server.closeAllConnections?.();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

const APPROVED_REQUIREMENTS = `# Requirements

## Overview

Display a deterministic greeting.

## Functional requirements

- [FR-1] The application displays "Hello from Hive".

## Non-functional requirements

- The behavior is deterministic.

## Acceptance criteria

- [AC-1] Running the application displays "Hello from Hive".

## Out of scope

- User-configurable greetings.

## For later

- Localized greetings.
`;

// The gate-clean FlowBlueprint the mock authoring agent produces: a review flow
// whose items move from new to done via manual actions, with a createInstance
// flow-level action writing the title field (the writer the title reads
// need). The real generate_definition gate runs against it in the e2e.
const AUTHORING_SPEC = {
  id: "reviewFlow",
  label: "Review Flow",
  description: "A review flow with a ready state and approve/reject actions.",
  configSchema: [],
  // A referenced tool: the generated definition is a module set whose entry
  // imports the stub file, so the flow-editor shows the referenced-file tabs.
  tools: [{ id: "websearch", ref: "./tools/websearch.ts" }],
  workflows: [
    {
      id: "items",
      label: "Items",
      instance: { title: "title" },
      display: { fields: [{ path: "title", label: "Title" }] },
      instanceState: [{ field: "title", type: "string" }],
      initialState: "new",
      terminalStates: ["done"],
      states: [
        {
          id: "new",
          label: "New",
          category: "initial",
          actions: [
            {
              id: "complete",
              label: "Complete",
              variant: "primary",
              transitionTo: "done",
            },
            {
              id: "reject",
              label: "Reject",
              variant: "destructive",
              transitionTo: "done",
            },
          ],
        },
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
          {
            key: "title",
            label: "Title",
            type: "string",
            required: true,
          },
        ],
      },
    },
  ],
  edges: [],
};

// ─── the research-loop flow (ticket 4) ────────────────────────────────

// The blueprint the research-loop authoring script converges on: a custom gate
// file ref on the transition, a custom websearch tool ref, and an output
// extractor that derives the verdict the gate reads.
const RESEARCH_SPEC = {
  id: "researchLoop",
  label: "Research Loop",
  configSchema: [],
  tools: [{ id: "websearch", ref: "./tools/websearch.ts" }],
  workflows: [
    {
      id: "research",
      label: "Research",
      instance: { title: "query" },
      display: {
        fields: [
          { path: "query", label: "Query" },
          { path: "verdict", label: "Verdict" },
        ],
      },
      instanceState: [
        { field: "query", type: "string" },
        { field: "verdict", type: "string" },
      ],
      initialState: "searching",
      terminalStates: ["done"],
      states: [
        {
          id: "searching",
          label: "Searching",
          category: "initial",
          tasks: [
            {
              id: "search",
              label: "Search the web",
              role: "ai-chat",
              systemPrompt:
                "You are the Research Agent. Search the web for the query, then call the completion tool with the top result's summary.",
              tools: ["websearch"],
              completionTool: "complete_task",
              startOnUserInput: true,
              inputFromInstanceState: "query",
            },
          ],
          // The gate transitions live in a state whose only task is the
          // extract: auto-transitions evaluate after each task, so a gate
          // sharing a state with the search task would fire before the
          // extractor has written the verdict it reads.
          autoTransitions: [
            {
              to: "extracting",
              gate: { kind: "taskSuccess", task: "search" },
            },
            {
              to: "needs_review",
              gate: { kind: "taskError", task: "search" },
            },
          ],
        },
        {
          id: "extracting",
          label: "Extracting",
          category: "active",
          tasks: [
            {
              id: "extractVerdict",
              label: "Extract verdict",
              role: "operation",
              extract: { ref: "./extractors/parse.ts", fields: ["verdict"] },
            },
          ],
          autoTransitions: [
            {
              to: "done",
              gate: { kind: "file", ref: "./gates/approved.ts" },
            },
            { to: "needs_review", gate: { kind: "always" } },
          ],
        },
        {
          id: "needs_review",
          label: "Needs review",
          category: "active",
          actions: [
            {
              id: "retry",
              label: "Retry",
              variant: "primary",
              transitionTo: "searching",
            },
          ],
        },
        { id: "done", label: "Done", category: "terminal" },
      ],
    },
  ],
  edges: [],
  actions: [
    {
      id: "add_research",
      label: "Add research",
      variant: "primary",
      createInstance: {
        workflowId: "research",
        fields: [
          { key: "query", label: "Query", type: "string", required: true },
        ],
      },
    },
  ],
};

// The implemented referenced files the research-loop authoring script writes
// (the "implement the stub" step) — the transport in the websearch tool is
// stubbed: the executor returns the shaped result directly.
const RESEARCH_GATE = `import type { GateContract } from "workflow-engine/workflow-types";

export const approved: GateContract = (ctx) => {
  return ctx.workflowInstanceState.verdict === "approved";
};
`;

const RESEARCH_TOOL = `import { defineTool } from "workflow-engine/runners";

// The primitive transport is stubbed in the e2e: the shaped result is
// returned directly (a real deployment would call a search endpoint here).
export const websearchTools = [
  defineTool({
    name: "websearch",
    description: "Search the web and return the top result.",
    parameters: {
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    executor: async (call) => {
      return {
        toolCallId: call.id,
        content: JSON.stringify({ title: "Hive docs", snippet: "good result" }),
        isError: false,
      };
    },
  }),
];
`;

const RESEARCH_EXTRACT = `import type { OutputExtractor } from "workflow-engine/workflow-types";

export const parse: OutputExtractor = (ctx) => {
  const search = ctx.taskOutputs.search as { output?: { completion?: { summary?: string } } } | undefined;
  const summary = search?.output?.completion?.summary ?? "";
  return { verdict: summary.includes("good") ? "approved" : "needs_review" };
};
`;

// The research-loop authoring script: set the blueprint → generate (the stubs
// pass the gate) → write the gate, tool, and extractor → regenerate (the
// implementations pass) → save. Stages are tracked by the tool_call_id of the
// last tool result.
function researchLoopCompletion(messages) {
  const toolMessages = messages.filter((message) => message.role === "tool");
  const lastId = toolMessages.at(-1)?.tool_call_id ?? "";
  if (toolMessages.length === 0) {
    return toolCompletion(
      [
        toolCall("research-bp", "set_flow_blueprint", {
          blueprint: JSON.stringify(RESEARCH_SPEC),
        }),
      ],
      "designing the research loop"
    );
  }
  if (lastId === "research-bp") {
    return toolCompletion(
      [
        toolCall("research-gen", "generate_definition", {
          blueprint: JSON.stringify(RESEARCH_SPEC),
        }),
      ],
      "generating the module set"
    );
  }
  if (lastId === "research-gen") {
    return toolCompletion(
      [
        toolCall("research-write-gate", "write_definition_file", {
          path: "./gates/approved.ts",
          content: RESEARCH_GATE,
        }),
      ],
      "implementing the gate"
    );
  }
  if (lastId === "research-write-gate") {
    return toolCompletion(
      [
        toolCall("research-write-tool", "write_definition_file", {
          path: "./tools/websearch.ts",
          content: RESEARCH_TOOL,
        }),
      ],
      "implementing the websearch tool"
    );
  }
  if (lastId === "research-write-tool") {
    return toolCompletion(
      [
        toolCall("research-write-extract", "write_definition_file", {
          path: "./extractors/parse.ts",
          content: RESEARCH_EXTRACT,
        }),
      ],
      "implementing the extractor"
    );
  }
  if (lastId === "research-write-extract") {
    return toolCompletion(
      [
        toolCall("research-gen2", "generate_definition", {
          blueprint: JSON.stringify(RESEARCH_SPEC),
        }),
      ],
      "regenerating with the implementations"
    );
  }
  if (lastId === "research-gen2") {
    return toolCompletion(
      [toolCall("research-save", "save_definition", {})],
      "saving the definition"
    );
  }
  if (lastId === "research-save") {
    return textCompletion("The research loop flow is registered and ready.");
  }
  throw new Error("Unexpected research-loop authoring state");
}

// The research agent at runtime: calls the custom websearch tool, then
// completes with a summary the extractor classifies as approved (so the custom
// gate routes the instance to done).
function researchAgentCompletion(messages) {
  const toolMessages = messages.filter((message) => message.role === "tool");
  const lastId = toolMessages.at(-1)?.tool_call_id ?? "";
  if (toolMessages.length === 0) {
    return toolCompletion(
      [toolCall("research-tool", "websearch", { query: "hive" })],
      "researching the query"
    );
  }
  if (lastId === "research-tool") {
    return toolCompletion(
      [
        toolCall("research-complete", "complete_task", {
          outcome: "implemented",
          summary: "good result",
          rationale: "found the top result",
        }),
      ],
      "completing the research"
    );
  }
  if (lastId === "research-complete") {
    return textCompletion("The research is complete.");
  }
  throw new Error("Unexpected Research Agent conversation state");
}
