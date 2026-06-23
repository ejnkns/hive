import type { Provider } from '../providers/registry.js'
import type { IncomingMessage } from 'node:http'

export type MutatedRequest = {
  headers: Record<string, string>
  body: string
}

export function mutateRequest(
  originalHeaders: IncomingMessage['headers'],
  originalBody: string,
  targetProvider: Provider,
  targetModel: string,
): MutatedRequest {
  const apiKey = process.env[targetProvider.apiKeyEnvVar]
  if (!apiKey) {
    throw new Error(`missing API key: ${targetProvider.apiKeyEnvVar}`)
  }

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }

  const bodyObj = JSON.parse(originalBody)
  bodyObj.model = targetModel

  return { headers, body: JSON.stringify(bodyObj) }
}
