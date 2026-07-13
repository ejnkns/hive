export type CompletionRequest = {
  payload: Record<string, unknown>;
  sessionId?: string;
};

export type CompletionResponse = {
  status: number;
  ok: boolean;
  body: string;
  provider: string | null;
  model: string | null;
};

export type ModelCaller = {
  complete: (request: CompletionRequest) => Promise<CompletionResponse>;
};
