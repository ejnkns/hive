import { PassThrough } from "node:stream";
import { routeRequest } from "./route-request";
import { mutateRequest } from "./mutate-request";
import { telemetryRecorder } from "../telemetry/recorder";
import type { Provider } from "../providers/registry";
import { buildChatEndpoint } from "../providers/registry";
import type { IncomingMessage } from "node:http";
import { logger } from "../hive/shared/logger";

export type FailoverResult = {
  success: boolean;
  provider?: string;
  model?: string;
  stream?: PassThrough;
  statusCode?: number;
  errorBody?: string;
};

const TIMEOUT_MS = 10000;

function sanitizePayloadForProvider(
  providerName: string,
  body: any,
): any {
  const cloned = JSON.parse(JSON.stringify(body));

  if (!cloned.messages || !Array.isArray(cloned.messages)) return cloned;

  // Strip reasoning_content from assistant messages for providers that reject it
  // opencode-zen (DeepSeek) requires it; all others reject it as an unsupported field
  if (providerName !== "opencode-zen") {
    cloned.messages = cloned.messages.map((msg: any) => {
      if (msg.role === "assistant" && "reasoning_content" in msg) {
        if (msg.reasoning_content && typeof msg.content === "string") {
          msg.content = `[Thought: ${msg.reasoning_content}]\n\n${msg.content}`;
        }
        delete msg.reasoning_content;
      }
      return msg;
    });
  }

  return cloned;
}

export async function failover(
  providers: Provider[],
  originalHeaders: IncomingMessage["headers"],
  originalBody: string,
): Promise<FailoverResult> {
  let parsedBody: any;
  try {
    parsedBody = JSON.parse(originalBody);
  } catch {
    logger.error("failover: failed to parse request body");
    return { success: false, statusCode: 400 };
  }

  for (const provider of providers) {
    const model = provider.defaultModel;
    logger.info(`failover: trying ${provider.name} (${model})`);

    // Pre-flight: skip Groq if payload exceeds its ~12k token limit
    // TODO: make token limit configurable per-provider; current estimate is
    // a rough heuristic based on character count, not actual tokenization
    if (provider.name === "groq") {
      const estimatedTokens = (parsedBody.messages?.length
        ? JSON.stringify(parsedBody.messages).length
        : JSON.stringify(parsedBody).length) / 4;
      if (estimatedTokens > 11500) {
        logger.info(
          `failover: skipping ${provider.name} — payload too large (est. ${Math.round(estimatedTokens)} tokens, limit ~11500)`,
        );
        continue;
      }
    }

    // Pre-flight: skip NVIDIA NIM when multi-tool calls are detected
    // NVIDIA NIM only supports single tool calls per turn
    // TODO: consider truncating to one tool call instead of full skip
    if (
      provider.name === "nvidia-nim" &&
      parsedBody.messages?.some(
        (m: any) => m.tool_calls && m.tool_calls.length > 1,
      )
    ) {
      logger.info(
        `failover: skipping ${provider.name} — multi-tool calls not supported`,
      );
      continue;
    }

    // Sanitize payload for provider-specific constraints
    const sanitized = sanitizePayloadForProvider(provider.name, parsedBody);

    let mutated: ReturnType<typeof mutateRequest>;
    try {
      mutated = mutateRequest(
        originalHeaders,
        JSON.stringify(sanitized),
        provider,
        model,
      );
    } catch (err: any) {
      logger.error(
        `failover: mutate request failed for ${provider.name}: ${err.message}`,
      );
      telemetryRecorder.recordMetric({
        provider: provider.name,
        model,
        ttft: TIMEOUT_MS,
        statusCode: 0,
        success: false,
        timestamp: Date.now(),
      });
      continue;
    }

    const endpoint = buildChatEndpoint(provider.baseUrl);
    const result = await routeRequest(
      endpoint,
      mutated,
      TIMEOUT_MS,
      provider.name,
      model,
    );

    if (result.success && result.statusCode < 400) {
      return {
        success: true,
        provider: provider.name,
        model,
        stream: result.stream!,
        statusCode: result.statusCode,
      };
    }

    logger.error(
      `failover: ${provider.name} failed — status ${result.statusCode}${result.errorBody ? `: ${result.errorBody.slice(0, 250)}` : ""}${result.errorType ? ` (${result.errorType})` : ""}`,
    );

    telemetryRecorder.recordMetric({
      provider: provider.name,
      model,
      ttft: result.ttft,
      statusCode: result.statusCode,
      success: false,
      timestamp: Date.now(),
    });
  }

  logger.error(`failover: all ${providers.length} providers exhausted`);
  return { success: false, statusCode: 503 };
}
