import type { Provider } from "../registry";

export const deepseek = {
  name: "deepseek",
  displayName: "DeepSeek",
  baseUrl: "https://api.deepseek.com",
  apiKeyEnvVar: "DEEPSEEK_API_KEY",
  models: [
    { id: "deepseek-v4-flash", contextLength: 1_000_000 },
    { id: "deepseek-v4-pro", contextLength: 1_000_000 },
  ],
  defaultModel: "deepseek-v4-flash",
  modelPreferences: ["deepseek-v4-flash", "deepseek-v4-pro"],
} satisfies Provider;
