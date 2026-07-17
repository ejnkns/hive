import type { Provider } from "../registry";

export const ovhcloud = {
  name: "ovhcloud",
  displayName: "OVHcloud AI",
  chatEndpoint: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions",
  modelsEndpoint: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/models",
  apiKeyEnvVar: "OVH_AI_ENDPOINTS_ACCESS_TOKEN",
  models: [
    { id: "Qwen3.5-397B-A17B", contextLength: 262_000 },
    { id: "Qwen3-Coder-30B-A3B-Instruct", contextLength: 256_000 },
    { id: "gpt-oss-120b", contextLength: 131_000 },
    { id: "Qwen3-32B", contextLength: 32_000 },
    { id: "Qwen3.6-27B", contextLength: 262_000 },
    { id: "Meta-Llama-3_3-70B-Instruct", contextLength: 131_000 },
    { id: "gpt-oss-20b", contextLength: 131_000 },
    { id: "Mistral-Small-3.2-24B-Instruct-2506", contextLength: 128_000 },
  ],
  defaultModel: "Qwen3.5-397B-A17B",
  modelPreferences: [
    "Qwen3.5-397B-A17B",
    "Qwen3-Coder-30B-A3B-Instruct",
    "gpt-oss-120b",
    "Qwen3-32B",
  ],
} satisfies Provider;
