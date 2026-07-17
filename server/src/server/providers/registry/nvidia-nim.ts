import type { Provider } from "../registry";

export const nvidiaNim = {
  name: "nvidia-nim",
  displayName: "NVIDIA NIM",
  chatEndpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
  modelsEndpoint: "https://integrate.api.nvidia.com/v1/models",
  apiKeyEnvVar: "NVIDIA_NIM_API_KEY",
  models: [
    { id: "meta/llama-3.3-70b-instruct", contextLength: 128_000 },
    { id: "nvidia/llama-3.1-nemotron-70b-instruct", contextLength: 128_000 },
    { id: "meta/llama-3.1-70b-instruct", contextLength: 128_000 },
  ],
  defaultModel: "meta/llama-3.3-70b-instruct",
  modelPreferences: [
    "meta/llama-3.3-70b-instruct",
    "deepseek-ai/deepseek-r1",
    "meta/llama-3.1-405b-instruct",
  ],
} satisfies Provider;
