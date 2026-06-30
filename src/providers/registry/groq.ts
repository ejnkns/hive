import type { Provider } from "../registry";

export const groq = {
  name: "groq",
  displayName: "Groq",
  baseUrl: "https://api.groq.com/openai",
  apiKeyEnvVar: "GROQ_API_KEY",
  models: [
    { id: "deepseek-r1-distill-llama-70b", contextLength: 128_000 },
    { id: "llama-3.3-70b-versatile", contextLength: 128_000 },
    { id: "mixtral-8x7b-32768", contextLength: 32_768 },
  ],
  defaultModel: "deepseek-r1-distill-llama-70b",
  modelPreferences: ["deepseek-r1-distill-llama-70b", "llama-3.3-70b-versatile", "mixtral-8x7b-32768"],
} satisfies Provider;
