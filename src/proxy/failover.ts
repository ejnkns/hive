import { PassThrough } from 'node:stream'
import { routeRequest } from './route-request.js'
import { mutateRequest } from './mutate-request.js'
import { telemetryRecorder } from '../telemetry/recorder.js'
import type { Provider } from '../providers.js'
import type { IncomingMessage } from 'node:http'

export type FailoverResult = {
  success: boolean
  provider?: string
  model?: string
  stream?: PassThrough
  statusCode?: number
}

const TIMEOUT_MS = 2500

export async function failover(
  providers: Provider[],
  originalHeaders: IncomingMessage['headers'],
  originalBody: string,
): Promise<FailoverResult> {
  for (const provider of providers) {
    const model = provider.defaultModel
    let mutated: ReturnType<typeof mutateRequest>
    try {
      mutated = mutateRequest(originalHeaders, originalBody, provider, model)
    } catch {
      telemetryRecorder.recordMetric({
        provider: provider.name,
        model,
        ttft: TIMEOUT_MS,
        statusCode: 0,
        success: false,
        timestamp: Date.now(),
      })
      continue
    }

    const result = await routeRequest(
      `${provider.baseUrl}/v1/chat/completions`,
      mutated,
      TIMEOUT_MS,
      provider.name,
      model,
    )

    if (result.success && result.statusCode < 400) {
      return {
        success: true,
        provider: provider.name,
        model,
        stream: result.stream!,
        statusCode: result.statusCode,
      }
    }

    telemetryRecorder.recordMetric({
      provider: provider.name,
      model,
      ttft: result.ttft,
      statusCode: result.statusCode,
      success: false,
      timestamp: Date.now(),
    })
  }

  return { success: false, statusCode: 503 }
}
