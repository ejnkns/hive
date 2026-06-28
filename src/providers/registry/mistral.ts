import type { Provider } from "../registry";

export const mistral = {
  name: "mistral",
  displayName: "Mistral",
  baseUrl: "https://api.mistral.ai",
  apiKeyEnvVar: "MISTRAL_API_KEY",
  models: ["mistral-large-latest", "mistral-small-latest", "codestral-latest"],
  defaultModel: "codestral-latest",
  modelPreferences: [
    "codestral-latest",
    "mistral-large-latest",
    "mistral-small-latest",
  ],
} satisfies Provider;
