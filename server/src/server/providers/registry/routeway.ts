import type { Provider } from "../registry";

export const routeway = {
  name: "routeway",
  displayName: "Routeway",
  chatEndpoint: "https://api.routeway.ai/v1/chat/completions",
  modelsEndpoint: "https://api.routeway.ai/v1/models",
  apiKeyEnvVar: "ROUTEWAY_API_KEY",
  models: [
    { id: "deepseek-v4-flash:free", contextLength: 1_000_000 },
    { id: "step-3.5-flash:free", contextLength: 256_000 },
    { id: "laguna-m.1:free", contextLength: 131_000 },
    { id: "laguna-xs.2:free", contextLength: 131_000 },
    { id: "ling-2.6-flash:free", contextLength: 262_000 },
    { id: "gpt-oss-120b:free", contextLength: 131_000 },
    { id: "gemma-4-31b-it:free", contextLength: 262_000 },
    { id: "nemotron-3-nano-30b-a3b:free", contextLength: 256_000 },
    { id: "llama-3.3-70b-instruct:free", contextLength: 131_000 },
    { id: "llama-3.1-8b-instruct:free", contextLength: 16_000 },
  ],
  defaultModel: "deepseek-v4-flash:free",
  modelPreferences: [
    "deepseek-v4-flash:free",
    "step-3.5-flash:free",
    "laguna-m.1:free",
    "gpt-oss-120b:free",
    "gemma-4-31b-it:free",
  ],
} satisfies Provider;
