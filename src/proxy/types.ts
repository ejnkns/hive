import type { PassThrough } from "node:stream";

export type ChatCompletionResult = {
  success: boolean;
  stream?: PassThrough;
  provider?: string;
  model?: string;
  statusCode?: number;
  error?: string;
};
