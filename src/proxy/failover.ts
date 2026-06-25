import { PassThrough } from "node:stream";
import { routeRequest } from "./route-request";
import { mutateRequest } from "./mutate-request";
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
  }

  logger.error(`failover: all ${providers.length} providers exhausted`);
  return { success: false, statusCode: 503 };
}
