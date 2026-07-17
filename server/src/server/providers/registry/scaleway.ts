import type { Provider } from "../registry";

export const scaleway = {
  name: "scaleway",
  displayName: "Scaleway",
  chatEndpoint: "https://api.scaleway.ai/v1/chat/completions",
  modelsEndpoint: "https://api.scaleway.ai/v1/models",
  apiKeyEnvVar: "SCALEWAY_API_KEY",
  models: [
    { id: "devstral-2-123b-instruct-2512", contextLength: 200_000 },
    { id: "qwen3-235b-a22b-instruct-2507", contextLength: 250_000 },
    { id: "glm-5.2", contextLength: 256_000 },
    { id: "qwen3.5-397b-a17b", contextLength: 250_000 },
    { id: "gpt-oss-120b", contextLength: 128_000 },
    { id: "mistral-medium-3.5-128b", contextLength: 256_000 },
    { id: "mistral-large-3-675b-instruct-2512", contextLength: 250_000 },
    { id: "qwen3-coder-30b-a3b-instruct", contextLength: 128_000 },
    { id: "qwen3.6-35b-a3b", contextLength: 256_000 },
    { id: "gemma-4-26b-a4b-it", contextLength: 256_000 },
    { id: "llama-3.3-70b-instruct", contextLength: 100_000 },
  ],
  defaultModel: "devstral-2-123b-instruct-2512",
  modelPreferences: [
    "devstral-2-123b-instruct-2512",
    "qwen3-235b-a22b-instruct-2507",
    "gpt-oss-120b",
    "mistral-medium-3.5-128b",
    "qwen3-coder-30b-a3b-instruct",
  ],
} satisfies Provider;
