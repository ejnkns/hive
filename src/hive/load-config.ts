export type ProviderConfig = {
  name: string
  baseUrl: string
  apiKeyEnvVar: string
  models: string[]
  defaultModel: string
}

export type HiveConfig = {
  port: number
  host: string
  providers: ProviderConfig[]
}

const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    name: 'groq',
    baseUrl: 'https://api.groq.com/openai',
    apiKeyEnvVar: 'GROQ_API_KEY',
    models: ['deepseek-r1-distill-llama-70b', 'llama-3.3-70b-versatile', 'mixtral-8x7b-32768'],
    defaultModel: 'deepseek-r1-distill-llama-70b',
  },
  {
    name: 'sambanova',
    baseUrl: 'https://api.sambanova.ai/v1',
    apiKeyEnvVar: 'SAMBA_NOVA_API_KEY',
    models: ['DeepSeek-R1', 'Meta-Llama-3.3-70B-Instruct'],
    defaultModel: 'DeepSeek-R1',
  },
]

export function loadConfig(): HiveConfig {
  return {
    port: Number(process.env.HIVE_PORT) || 19280,
    host: process.env.HIVE_HOST || '127.0.0.1',
    providers: [...DEFAULT_PROVIDERS],
  }
}
