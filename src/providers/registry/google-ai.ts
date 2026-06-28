import type { Provider } from "../registry";

export const googleAi = {
  name: "google-ai",
  displayName: "Google AI",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  apiKeyEnvVar: "GOOGLE_API_KEY",
  models: ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0-flash-exp"],
  defaultModel: "gemini-2.0-flash-exp",
  modelPreferences: [
    "gemini-2.0-flash",
    "gemini-1.5-pro",
    "gemini-1.5-flash",
    "gemini-2.0-flash-exp",
  ],
} satisfies Provider;
