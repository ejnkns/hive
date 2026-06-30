import type { Provider } from "../registry";

export const mistral = {
  name: "mistral",
  displayName: "Mistral",
  baseUrl: "https://api.mistral.ai",
  apiKeyEnvVar: "MISTRAL_API_KEY",
  models: [
    { id: "mistral-large-latest", contextLength: 128_000 },
    { id: "mistral-small-latest", contextLength: 32_000 },
    { id: "codestral-latest", contextLength: 256_000 },
  ],
  defaultModel: "codestral-latest",
  modelPreferences: ["codestral-latest", "mistral-large-latest", "mistral-small-latest"],
} satisfies Provider;
