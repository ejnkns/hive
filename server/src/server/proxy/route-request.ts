import http from "node:http";
import https from "node:https";
import { PassThrough } from "node:stream";
import { URL } from "node:url";
import { logger } from "shared/logger";
import type { FinishReason, StreamPhaseEvent, TelemetrySink } from "telemetry";
import { classifyError, createStreamCounter, detectRefusal } from "telemetry";
import type { MutatedRequest } from "./mutate-request";
import { ProviderRequestCancelledError } from "./provider-request-cancelled-error";
import { ProxyResponse } from "./proxy-response";
import {
  recordNodeDispatched,
  recordResponseComplete,
  recordStreamingStarted,
  recordThinkingStarted,
  recordTokenTick,
  recordToolAccumulating,
} from "./session-aggregator";

type RouteRequestOptions = {
  upstreamUrl: string;
  mutated: MutatedRequest;
  timeoutMs: number;
  providerName: string;
  modelName: string;
  requestId: string;
  telemetrySink: TelemetrySink;
  signal?: AbortSignal;
};

type RouteResult = {
  proxyResponse: ProxyResponse;
  ttft: number;
  requestId: string;
};

export function routeRequest(opts: RouteRequestOptions): Promise<RouteResult> {
  const {
    upstreamUrl,
    mutated,
    timeoutMs,
    providerName,
    modelName,
    requestId,
    telemetrySink,
    signal,
  } = opts;
  return new Promise((resolve, reject) => {
    const url = new URL(upstreamUrl);
    const start = Date.now();

    const bodyBuffer = Buffer.from(mutated.body);
    let upstreamResponse: http.IncomingMessage | null = null;
    let downstreamStream: PassThrough | null = null;
    let recorded = false;

    recordNodeDispatched({
      requestId,
      provider: providerName,
      model: modelName,
      attempt: 0,
    });

    const requestOptions: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || undefined,
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        ...mutated.headers,
        "Content-Length": bodyBuffer.length.toString(),
      },
      timeout: timeoutMs,
    };

    const record = (
      ttft: number,
      success: boolean,
      statusCode: number,
      errorBody?: string,
      errorType?: string,
      outputBody?: string,
      stats?: {
        outputChars: number;
        thinkingChars: number;
        thinkingStart: number | null;
        thinkingEnd: number | null;
        thinkingTime: number | null;
        finishReason: string | null;
        responseText: string;
        inputTokens: number | null;
        outputTokensFromUsage: number | null;
        toolCallFailed: boolean;
      }
    ) => {
      if (recorded) return;
      recorded = true;
      signal?.removeEventListener("abort", abort);
      const totalLatency = Date.now() - start;
      const outputTokens =
        stats?.outputTokensFromUsage ??
        (stats ? Math.round(stats.outputChars / 4) : null);
      const inputTokens = stats?.inputTokens ?? null;

      telemetrySink.recordMetric({
        requestId,
        provider: providerName,
        model: modelName,
        timestamp: Date.now(),
        ttft,
        totalLatency,
        inputTokens,
        outputTokens,
        thinkingTime: stats?.thinkingTime ?? null,
        // finishReason comes from stream counter — always a valid FinishReason or null
        finishReason: (stats?.finishReason as FinishReason) ?? null,
        refused: outputBody
          ? detectRefusal(outputBody)
          : stats?.responseText
            ? detectRefusal(stats.responseText)
            : false,
        statusCode,
        errorBody,
        errorType: classifyError(statusCode, errorType),
        success,
        source: "user",
        toolCallFailed: stats?.toolCallFailed ?? false,
      });

      recordResponseComplete({
        requestId,
        provider: providerName,
        model: modelName,
        statusCode,
        success,
        ttft,
        totalLatency,
        outputTokens,
        finishReason: stats?.finishReason ?? null,
        toolCallFailed: stats?.toolCallFailed ?? false,
        errorType: classifyError(statusCode, errorType),
      });
    };

    const requester = url.protocol === "https:" ? https : http;
    const req = requester.request(requestOptions, (res) => {
      upstreamResponse = res;
      const statusCode = res.statusCode ?? 500;

      if (statusCode >= 400) {
        logger.debug(
          `upstream ${providerName}:${modelName} — error response ${String(statusCode)}`
        );
        let errorBody = "";
        res.on("data", (chunk: Buffer) => {
          errorBody += chunk.toString();
        });
        res.on("end", () => {
          logger.debug(
            `upstream ${providerName}:${modelName} — error body (${String(errorBody.length)} bytes): ${errorBody.slice(0, 1000)}`
          );
          record(timeoutMs, false, statusCode, errorBody);
          resolve({
            proxyResponse: ProxyResponse.error(statusCode, errorBody),
            ttft: timeoutMs,
            requestId,
          });
        });
        return;
      }

      const passThrough = new PassThrough();
      downstreamStream = passThrough;
      let ttft = timeoutMs;
      let initialByteReceived = false;
      let streamErrored = false;
      const counter = createStreamCounter(start, (evt: StreamPhaseEvent) => {
        switch (evt.kind) {
          case "thinking_started":
            recordThinkingStarted({
              requestId,
              provider: providerName,
              model: modelName,
            });
            break;
          case "streaming_started":
            recordStreamingStarted({
              requestId,
              provider: providerName,
              model: modelName,
            });
            break;
          case "tool_accumulating":
            recordToolAccumulating({
              requestId,
              provider: providerName,
              model: modelName,
              toolIndex: evt.toolIndex,
            });
            break;
          case "token_tick": {
            const elapsedSec = evt.elapsedMs / 1000;
            const tps =
              elapsedSec > 0 ? Math.round(evt.outputChars / elapsedSec) : 0;
            recordTokenTick({
              requestId,
              provider: providerName,
              model: modelName,
              outputChars: evt.outputChars,
              thinkingChars: evt.thinkingChars,
              tokensPerSecond: tps,
            });
            break;
          }
        }
      });

      res.once("data", (chunk: Buffer) => {
        ttft = Date.now() - start;
        initialByteReceived = true;

        const { transform } = counter;
        transform.write(chunk);
        res.pipe(transform);
        transform.pipe(passThrough);

        logger.debug(
          `upstream ${providerName}:${modelName} — first byte in ${String(ttft)}ms`
        );

        resolve({
          proxyResponse: ProxyResponse.ok(statusCode, passThrough),
          ttft,
          requestId,
        });

        logger.debug(
          `upstream ${providerName}:${modelName} — resolve() called, passThrough writable=${String(passThrough.writable)}, readable=${String(passThrough.readable)}`
        );
      });

      res.on("error", (err: Error) => {
        streamErrored = true;
        logger.debug(
          `upstream ${providerName}:${modelName} — stream error: ${err.message}`
        );
        const stats = counter.getStats();
        record(
          Date.now() - start,
          false,
          500,
          undefined,
          "STREAM_ERROR",
          undefined,
          stats
        );

        if (!initialByteReceived) {
          resolve({
            proxyResponse: ProxyResponse.error(500, ""),
            ttft: Date.now() - start,
            requestId,
          });
        }
      });

      res.on("end", () => {
        const stats = counter.getStats();
        const effectiveTtft = initialByteReceived ? ttft : Date.now() - start;
        const isSuccess = !stats.isAbruptDisconnect;

        logger.debug(
          `upstream ${providerName}:${modelName} — res.on(end): initialByteReceived=${String(initialByteReceived)}, outputChars=${String(stats.outputChars)}, abrupt=${String(stats.isAbruptDisconnect)}, resolveAlreadyCalled=${String(initialByteReceived)}`
        );

        if (!streamErrored && !stats.isAbruptDisconnect) {
          telemetrySink.completeConversation(requestId, {
            provider: providerName,
            model: modelName,
            ttft: effectiveTtft,
            totalLatency: Date.now() - start,
            statusCode,
            success: true,
            responseText: stats.responseText,
            outputTokens: Math.round(stats.outputChars / 4),
            finishReason: stats.finishReason,
            refused: detectRefusal(stats.responseText),
          });
        }

        logger.debug(
          `upstream ${providerName}:${modelName} — stream complete (${String(stats.outputChars)} chars, abrupt=${String(stats.isAbruptDisconnect)})`
        );

        record(
          effectiveTtft,
          isSuccess,
          statusCode,
          undefined,
          undefined,
          undefined,
          stats
        );

        if (!initialByteReceived) {
          resolve({
            proxyResponse: ProxyResponse.ok(statusCode, passThrough),
            ttft: effectiveTtft,
            requestId,
          });
        }
      });
    });

    function abort(): void {
      recorded = true;
      signal?.removeEventListener("abort", abort);
      downstreamStream?.destroy();
      upstreamResponse?.destroy();
      req.destroy();
      reject(new ProviderRequestCancelledError(signal?.reason));
    }

    req.on("timeout", () => {
      logger.debug(
        `upstream ${providerName}:${modelName} — timeout after ${String(timeoutMs)}ms`
      );
      req.destroy();
      record(timeoutMs, false, 0, undefined, "TIMEOUT");
      resolve({
        proxyResponse: ProxyResponse.error(0, "TIMEOUT"),
        ttft: timeoutMs,
        requestId,
      });
    });

    req.on("error", (err: Error) => {
      const elapsed = Date.now() - start;
      logger.debug(
        `upstream ${providerName}:${modelName} — network error: ${err.message}`
      );
      record(elapsed, false, 0, undefined, "NETWORK_ERROR");
      resolve({
        proxyResponse: ProxyResponse.error(0, "NETWORK_ERROR"),
        ttft: elapsed,
        requestId,
      });
    });

    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });

    req.write(bodyBuffer);
    req.end();
  });
}
