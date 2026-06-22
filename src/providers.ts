export type Provider = {
  name: string
  baseUrl: string
  apiKeyEnvVar: string
  models: string[]
  defaultModel: string
}

export type ProviderState = {
  provider: string
  model: string
  enabled: boolean
  stabilityScore: number
}

import { groq } from './providers/groq.js'
import { sambanova } from './providers/sambanova.js'

export const providers: Provider[] = [groq, sambanova]

export { sortByPriority, updateScore } from './providers/priority-queue.js'
