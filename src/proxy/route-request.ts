import http from "node:http"
import https from "node:https"
import { PassThrough } from "node:stream"
import { URL } from "node:url"
import type { MutatedRequest } from "./mutate-request"
import { telemetryRecorder, createStreamCounter, classifyError, detectRefusal } from "../telemetry"

export type RouteResult = {
  success: boolean
  statusCode: number
  stream?: PassThrough
  ttft: number
  errorType?: string
  errorBody?: string
}

export function routeRequest(
  upstreamUrl: string,
  mutated: MutatedRequest,
  timeoutMs: number,
  providerName: string,
  modelName: string,
): Promise<RouteResult> {
  return new Promise((resolve) => {
    const url = new URL(upstreamUrl)
    const start = Date.now()

    const bodyBuffer = Buffer.from(mutated.body)

    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || undefined,
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        ...mutated.headers,
        "Content-Length": bodyBuffer.length.toString(),
      },
      timeout: timeoutMs,
    }

    const record = (
      ttft: number,
      success: boolean,
      statusCode: number,
      errorBody?: string,
      errorType?: string,
      outputBody?: string,
      stats?: { outputChars: number; thinkingChars: number; thinkingStart: number | null; finishReason: string | null },
    ) => {
      const totalLatency = Date.now() - start
      const outputTokens = stats ? Math.round(stats.outputChars / 4) : null
      const inputTokens = null

      telemetryRecorder.recordMetric({
        provider: providerName,
        model: modelName,
        timestamp: Date.now(),
        ttft,
        totalLatency,
        inputTokens,
        outputTokens,
        thinkingTime: stats?.thinkingStart ?? null,
        finishReason: (stats?.finishReason as any) ?? null,
        refused: outputBody ? detectRefusal(outputBody) : false,
        statusCode,
        errorType: classifyError(statusCode, errorType),
        success,
        source: "user",
      })
    }

    const requester = url.protocol === "https:" ? https : http
    const req = requester.request(options, (res) => {
      const statusCode = res.statusCode ?? 500

      if (statusCode >= 400) {
        let errorBody = ""
        res.on("data", (chunk: Buffer) => {
          errorBody += chunk.toString()
        })
        res.on("end", () => {
          record(timeoutMs, false, statusCode, errorBody)
          resolve({ success: false, statusCode, ttft: timeoutMs, errorBody })
        })
        return
      }

      const passThrough = new PassThrough()
      let ttft = timeoutMs
      let initialByteReceived = false
      const counter = createStreamCounter(start)

      res.once("data", (chunk: Buffer) => {
        ttft = Date.now() - start
        initialByteReceived = true

        const { transform } = counter
        transform.write(chunk)
        res.pipe(transform)
        transform.pipe(passThrough)

        resolve({
          success: true,
          statusCode,
          stream: passThrough,
          ttft,
        })
      })

      res.on("error", () => {
        const stats = counter.getStats()
        record(Date.now() - start, false, 500, undefined, "STREAM_ERROR", undefined, stats)

        if (!initialByteReceived) {
          resolve({
            success: false,
            statusCode: 500,
            ttft: Date.now() - start,
            errorType: "STREAM_ERROR",
          })
        }
      })

      res.on("end", () => {
        const stats = counter.getStats()
        const effectiveTtft = initialByteReceived ? ttft : Date.now() - start
        record(effectiveTtft, true, statusCode, undefined, undefined, undefined, stats)

        if (!initialByteReceived) {
          resolve({
            success: true,
            statusCode,
            stream: passThrough,
            ttft: effectiveTtft,
          })
        }
      })
    })

    req.on("timeout", () => {
      req.destroy()
      record(timeoutMs, false, 0, undefined, "TIMEOUT")
      resolve({
        success: false,
        statusCode: 0,
        ttft: timeoutMs,
        errorType: "TIMEOUT",
      })
    })

    req.on("error", () => {
      const elapsed = Date.now() - start
      record(elapsed, false, 0, undefined, "NETWORK_ERROR")
      resolve({
        success: false,
        statusCode: 0,
        ttft: elapsed,
        errorType: "NETWORK_ERROR",
      })
    })

    req.write(bodyBuffer)
    req.end()
  })
}
