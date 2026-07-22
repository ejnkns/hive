import { isRecord } from "shared/board-types";

export type PlaygroundRoute = {
  providerName: string;
  modelName: string;
};

export type ProviderTestResult = {
  providerName: string | null;
  modelName: string | null;
};

export async function runProviderTest(params: {
  prompt: string;
  route: PlaygroundRoute | null;
  signal: AbortSignal;
  onRoute: (result: ProviderTestResult) => void;
  onDelta: (content: string) => void;
}): Promise<ProviderTestResult> {
  const { prompt, route, signal, onRoute, onDelta } = params;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (route) {
    headers["X-Hive-Playground-Provider"] = route.providerName;
    headers["X-Hive-Playground-Model"] = route.modelName;
  } else {
    headers["X-Hive-Playground-Mode"] = "auto";
  }

  const response = await fetch("/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: route?.modelName ?? "auto",
      messages: [{ role: "user", content: prompt }],
      stream: true,
    }),
    signal,
  });
  const result = {
    providerName: response.headers.get("X-Hive-Provider"),
    modelName: response.headers.get("X-Hive-Model"),
  };
  onRoute(result);

  if (!response.ok) throw new Error(await responseError(response));
  if (!response.body) throw new Error("Provider returned no response stream");
  await consumeEventStream(response.body, onDelta);
  return result;
}

async function consumeEventStream(
  stream: ReadableStream<Uint8Array>,
  onDelta: (content: string) => void
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";
    for (const event of events) {
      completed = consumeEvent(event, onDelta) || completed;
    }
    if (done) break;
  }
  if (buffer.trim()) completed = consumeEvent(buffer, onDelta) || completed;
  if (!completed) {
    throw new Error("Provider response ended before its completion marker");
  }
}

function consumeEvent(
  event: string,
  onDelta: (content: string) => void
): boolean {
  let completed = false;
  for (const line of event.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data) continue;
    if (data === "[DONE]") {
      completed = true;
      continue;
    }

    let value: unknown;
    try {
      value = JSON.parse(data);
    } catch {
      // Ignore SSE comments or provider-specific non-JSON metadata.
      continue;
    }
    const error = completionError(value);
    if (error) throw new Error(error);
    const content = completionDelta(value);
    if (content) onDelta(content);
  }
  return completed;
}

function completionDelta(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.choices)) return "";
  const choice = value.choices[0];
  if (!isRecord(choice)) return "";
  const delta = choice.delta;
  if (isRecord(delta) && typeof delta.content === "string") {
    return delta.content;
  }
  const message = choice.message;
  return isRecord(message) && typeof message.content === "string"
    ? message.content
    : "";
}

function completionError(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (typeof value.error === "string") return value.error;
  if (isRecord(value.error) && typeof value.error.message === "string") {
    return value.error.message;
  }
  return null;
}

async function responseError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const error = completionError(JSON.parse(text) as unknown);
    if (error) return error;
  } catch {
    // Use the upstream text below.
  }
  return text || `Provider test failed with HTTP ${String(response.status)}`;
}
