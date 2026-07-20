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
    return textCompletion(
      `\`\`\`json\n${JSON.stringify({
        changes: [
          {
            action: "create",
            rationale: "Implement the accepted initial requirements",
            proposedCard: {
              title: "Render deterministic greeting",
              description:
                "Render the approved greeting from the application entry point.",
              acceptanceCriteria: [
                "Running the application displays Hello from Hive",
              ],
              relevantFiles: ["src/app.ts"],
              dependencies: [],
              requirementRefs: ["FR-1", "AC-1"],
            },
          },
        ],
      })}\n\`\`\``
    );
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

function assertAssistantTurn(messages, reasoningContent, toolCallCount) {
  const assistant = messages.find(
    (message) =>
      message.role === "assistant" &&
      message.reasoning_content === reasoningContent
  );
  assert.ok(assistant, "provider reasoning must survive the tool turn");
  assert.equal(
    assistant.tool_calls?.length,
    toolCallCount,
    "one assistant turn must preserve every tool call"
  );
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
