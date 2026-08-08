/** @public — the OpenAI-compatible message shape shared by the ai runners, the workflow schema, and the proxy. */

export type ChatMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  // OpenAI-compatible tool call state: assistant messages carry the tool_calls
  // they issued, and the matching tool messages reference them by id. Required
  // for providers to accept a conversation that used tools.
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};
