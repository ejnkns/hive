/** @public */

export type Message = {
  role: string;
  content: string;
  reasoning_content?: string;
  reasoning?: string;
  tool_calls?: unknown[];
  tool_call_id?: string;
};
