import type { Provider } from "./registry";

export const lmStudio = {
  name: "lm-studio",
  displayName: "LM Studio",
  baseUrl: "127.0.0.1:1234",
  apiKeyEnvVar: "LM_STUDIO_API_KEY",
  models: [],
  defaultModel: "gpt-5.5",
  modelPreferences: [],
} satisfies Provider;
