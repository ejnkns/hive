export type OrchestrationEvent =
  | { type: "iteration_start"; iteration: number }
  | { type: "streaming_started"; iteration: number }
  | { type: "content_delta"; iteration: number; content: string }
  | {
      type: "model_complete";
      iteration: number;
      finishReason: string | null;
      toolCallCount: number;
    }
  | {
      type: "tool_executed";
      iteration: number;
      toolName: string;
      isError: boolean;
      contentPreview: string;
    }
  | { type: "complete"; finishReason: string; iterations: number }
  | { type: "error"; error: string };
