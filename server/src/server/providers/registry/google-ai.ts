import type { Provider } from "../registry";

export const googleAi = {
  name: "google-ai",
  displayName: "Google AI",
  chatEndpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  modelsEndpoint: "https://generativelanguage.googleapis.com/v1beta/openai/models",
  apiKeyEnvVar: "GOOGLE_API_KEY",
  models: [
    { id: "gemini-1.5-pro", contextLength: 2_097_152 },
    { id: "gemini-1.5-flash", contextLength: 1_048_576 },
    { id: "gemini-2.0-flash-exp", contextLength: 1_048_576 },
  ],
  defaultModel: "gemini-2.0-flash-exp",
  modelPreferences: [
    "gemini-2.0-flash",
    "gemini-1.5-pro",
    "gemini-1.5-flash",
    "gemini-2.0-flash-exp",
  ],
} satisfies Provider;
