import type { Provider } from "../registry";

export const sambanova = {
  name: "sambanova",
  displayName: "SambaNova",
  chatEndpoint: "https://api.sambanova.ai/v1/chat/completions",
  modelsEndpoint: "https://api.sambanova.ai/v1/models",
  apiKeyEnvVar: "SAMBA_NOVA_API_KEY",
  models: [
    { id: "DeepSeek-R1", contextLength: 128_000 },
    { id: "Meta-Llama-3.3-70B-Instruct", contextLength: 128_000 },
  ],
  defaultModel: "DeepSeek-R1",
  modelPreferences: ["DeepSeek-R1", "Meta-Llama-3.3-70B-Instruct"],
} satisfies Provider;
