import http from 'node:http'
import { PassThrough } from 'node:stream'
import { URL } from 'node:url'
import type { MutatedRequest } from './mutate-request.js'
import { telemetryRecorder } from '../telemetry/recorder.js'

export type RouteResult = {
  success: boolean
  statusCode: number
  stream?: PassThrough
  ttft: number
  errorType?: string
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

    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        ...mutated.headers,
        'Content-Length': bodyBuffer.length.toString(),
      },
      timeout: timeoutMs,
    }

    const req = http.request(options, (res) => {
      const passThrough = new PassThrough()
      let ttft = timeoutMs
      let initialByteReceived = false

      const statusCode = res.statusCode ?? 500

      if (statusCode >= 400) {
        resolve({ success: false, statusCode, ttft })
        return
      }

      res.once('data', () => {
        ttft = Date.now() - start
        initialByteReceived = true
        resolve({
          success: true,
          statusCode,
          stream: passThrough,
          ttft,
        })
      })

      res.on('error', () => {
        telemetryRecorder.recordMetric({
          provider: providerName,
          model: modelName,
          ttft: Date.now() - start,
          statusCode: 500,
          success: false,
          timestamp: Date.now(),
        })

        if (!initialByteReceived) {
          resolve({
            success: false,
            statusCode: 500,
            ttft: Date.now() - start,
            errorType: 'STREAM_ERROR',
          })
        }
      })

      res.on('end', () => {
        telemetryRecorder.recordMetric({
          provider: providerName,
          model: modelName,
          ttft: initialByteReceived ? ttft : Date.now() - start,
          statusCode,
          success: true,
          timestamp: Date.now(),
        })
      })

      res.pipe(passThrough)
    })

    req.on('timeout', () => {
      req.destroy()
      resolve({
        success: false,
        statusCode: 0,
        ttft: timeoutMs,
        errorType: 'TIMEOUT',
      })
    })

    req.on('error', () => {
      resolve({
        success: false,
        statusCode: 0,
        ttft: Date.now() - start,
        errorType: 'NETWORK_ERROR',
      })
    })

    req.write(bodyBuffer)
    req.end()
  })
}
