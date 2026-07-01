import type { Provider } from "../registry";

export const cerebras = {
  name: "cerebras",
  displayName: "Cerebras",
  baseUrl: "https://api.cerebras.ai",
  apiKeyEnvVar: "CEREBRAS_API_KEY",
  models: [
    { id: "llama-3.3-70b", contextLength: 8_192 },
    { id: "llama-3.1-8b", contextLength: 8_192 },
  ],
  defaultModel: "llama-3.3-70b",
  modelPreferences: ["llama-3.3-70b", "llama-3.1-8b"],
} satisfies Provider;
