import http from "node:http";
import https from "node:https";
import { PassThrough } from "node:stream";
import { URL } from "node:url";
import type { MutatedRequest } from "./mutate-request";
import {
  telemetryRecorder,
  createStreamCounter,
  classifyError,
  detectRefusal,
  conversationStore,
} from "../telemetry";
import { ProxyResponse } from "./proxy-response";

type RouteRequestOptions = {
  upstreamUrl: string;
  mutated: MutatedRequest;
  timeoutMs: number;
  providerName: string;
  modelName: string;
  requestId: string;
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
  } = opts;
  return new Promise((resolve) => {
    const url = new URL(upstreamUrl);
    const start = Date.now();

    const bodyBuffer = Buffer.from(mutated.body);

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
      }
    ) => {
      const totalLatency = Date.now() - start;
      const outputTokens =
        stats?.outputTokensFromUsage ??
        (stats ? Math.round(stats.outputChars / 4) : null);
      const inputTokens = stats?.inputTokens ?? null;

      telemetryRecorder.recordMetric({
        requestId,
        provider: providerName,
        model: modelName,
        timestamp: Date.now(),
        ttft,
        totalLatency,
        inputTokens,
        outputTokens,
        thinkingTime: stats?.thinkingTime ?? null,
        finishReason: (stats?.finishReason as any) ?? null,
        refused: outputBody
          ? detectRefusal(outputBody)
          : stats?.responseText
            ? detectRefusal(stats.responseText)
            : false,
        statusCode,
        errorType: classifyError(statusCode, errorType),
        success,
        source: "user",
      });
    };

    const requester = url.protocol === "https:" ? https : http;
    const req = requester.request(requestOptions, (res) => {
      const statusCode = res.statusCode ?? 500;

      if (statusCode >= 400) {
        let errorBody = "";
        res.on("data", (chunk: Buffer) => {
          errorBody += chunk.toString();
        });
        res.on("end", () => {
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
      let ttft = timeoutMs;
      let initialByteReceived = false;
      let streamErrored = false;
      const counter = createStreamCounter(start);

      res.once("data", (chunk: Buffer) => {
        ttft = Date.now() - start;
        initialByteReceived = true;

        const { transform } = counter;
        transform.write(chunk);
        res.pipe(transform);
        transform.pipe(passThrough);

        resolve({
          proxyResponse: ProxyResponse.ok(statusCode, passThrough),
          ttft,
          requestId,
        });
      });

      res.on("error", () => {
        streamErrored = true;
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
        record(
          effectiveTtft,
          !stats.isAbruptDisconnect,
          statusCode,
          undefined,
          undefined,
          undefined,
          stats
        );

        if (!streamErrored && !stats.isAbruptDisconnect) {
          conversationStore.completeConversation(requestId, {
            provider: providerName,
            model: modelName,
            ttft: effectiveTtft,
            totalLatency: Date.now() - start,
            statusCode,
            success: true,
            responseText: stats.responseText,
            outputTokens: stats ? Math.round(stats.outputChars / 4) : null,
            finishReason: stats.finishReason,
            refused: detectRefusal(stats.responseText),
          });
        }

        if (!initialByteReceived) {
          resolve({
            proxyResponse: ProxyResponse.ok(statusCode, passThrough),
            ttft: effectiveTtft,
            requestId,
          });
        }
      });
    });

    req.on("timeout", () => {
      req.destroy();
      record(timeoutMs, false, 0, undefined, "TIMEOUT");
      resolve({
        proxyResponse: ProxyResponse.error(0, "TIMEOUT"),
        ttft: timeoutMs,
        requestId,
      });
    });

    req.on("error", () => {
      const elapsed = Date.now() - start;
      record(elapsed, false, 0, undefined, "NETWORK_ERROR");
      resolve({
        proxyResponse: ProxyResponse.error(0, "NETWORK_ERROR"),
        ttft: elapsed,
        requestId,
      });
    });

    req.write(bodyBuffer);
    req.end();
  });
}
