/** @internal — wraps handleChatCompletion as a ModelCaller for the orchestrator */

import { type PassThrough, Readable } from "node:stream";
import { logger } from "shared/logger";
import { handleChatCompletion } from "../proxy/proxy";
import type { ModelCaller } from "./types";

export function createHandleChatCompletionCaller(): ModelCaller {
  return {
    complete: async (request) => {
      const headers: Record<string, string | string[] | undefined> = {};
      if (request.sessionId) {
        headers["x-session-id"] = request.sessionId;
      }

      const payloadKeys = Object.keys(request.payload);
      const toolsCount = Array.isArray(request.payload.tools)
        ? request.payload.tools.length
        : 0;
      const messagesCount = Array.isArray(request.payload.messages)
        ? request.payload.messages.length
        : 0;
      logger.debug(
        `handleChatCompletionCaller — payload keys: [${payloadKeys.join(", ")}], messages: ${String(messagesCount)}, tools: ${String(toolsCount)}, sessionId: ${request.sessionId ?? "none"}`
      );

      const result = await handleChatCompletion(request.payload, headers);

      logger.debug(
        `handleChatCompletionCaller — result: success=${String(result.success)}, status=${String(result.statusCode)}, hasStream=${String(!!result.stream)}, provider=${result.provider ?? "none"}, model=${result.model ?? "none"}, error=${result.error ?? "none"}`
      );

      if (!result.success) {
        return {
          status: result.statusCode ?? 500,
          ok: false,
          stream: new Readable({
            read() {
              this.push(null);
            },
          }),
          provider: null,
          model: null,
          error: result.error,
        };
      }

      // success is true, so stream is defined per ChatCompletionResult contract
      const stream = result.stream as PassThrough;
      return {
        status: result.statusCode ?? 200,
        ok: true,
        stream,
        provider: result.provider ?? null,
        model: result.model ?? null,
      };
    },
  };
}
