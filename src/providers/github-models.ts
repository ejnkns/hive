import type { Provider } from "./registry";

export const githubModels = {
  name: "github-models",
  displayName: "GitHub Models",
  baseUrl: "https://models.github.ai/inference",
  apiKeyEnvVar: "GITHUB_TOKEN",
  models: [
    "gpt-4o",
    "gpt-4o-mini",
    "o1",
    "claude-3-5-sonnet",
    "llama-3.3-70b-instruct",
  ],
  defaultModel: "gpt-4o",
  modelPreferences: [
    "gpt-4o",
    "gpt-4o-mini",
    "o1",
    "claude-3-5-sonnet",
    "llama-3.3-70b-instruct",
  ],
} satisfies Provider;
