import type { Provider } from "./registry";

export const sambanova = {
  name: "sambanova",
  displayName: "SambaNova",
  baseUrl: "https://api.sambanova.ai",
  apiKeyEnvVar: "SAMBA_NOVA_API_KEY",
  models: ["DeepSeek-R1", "Meta-Llama-3.3-70B-Instruct"],
  defaultModel: "DeepSeek-R1",
  modelPreferences: ["DeepSeek-R1", "Meta-Llama-3.3-70B-Instruct"],
} satisfies Provider;
