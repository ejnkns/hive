import type { Provider } from "../registry";

export const githubModels = {
  name: "github-models",
  displayName: "GitHub Models",
  chatEndpoint: "https://models.github.ai/inference/v1/chat/completions",
  modelsEndpoint: "https://models.github.ai/inference/v1/models",
  apiKeyEnvVar: "GITHUB_TOKEN",
  models: [
    { id: "gpt-4o", contextLength: 128_000 },
    { id: "gpt-4o-mini", contextLength: 128_000 },
    { id: "o1", contextLength: 200_000 },
    { id: "claude-3-5-sonnet", contextLength: 200_000 },
    { id: "llama-3.3-70b-instruct", contextLength: 128_000 },
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
