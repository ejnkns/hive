import type { Provider } from "../registry";

export const ollama = {
  name: "ollama",
  displayName: "Ollama",
  baseUrl: "http://127.0.0.1:11434",
  apiKeyEnvVar: "OLLAMA_API_KEY",
  models: [
    "llama3.1",
    "llama3.2",
    "mistral",
    "codellama",
    "mixtral",
    "deepseek-r1",
    "phi4",
    "qwen2.5",
  ],
  defaultModel: "llama3.1",
  modelPreferences: [
    "deepseek-r1",
    "llama3.1",
    "llama3.2",
    "mistral",
    "mixtral",
    "phi4",
    "codellama",
    "qwen2.5",
  ],
} satisfies Provider;
