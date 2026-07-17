import type { Provider } from "../registry";

export const ollamaCloud = {
  name: "ollama-cloud",
  displayName: "Ollama Cloud",
  chatEndpoint: "https://ollama.com/v1/chat/completions",
  modelsEndpoint: "https://ollama.com/v1/models",
  apiKeyEnvVar: "OLLAMA_CLOUD_API_KEY",
  models: [
    { id: "devstral-2:123b", contextLength: 256_000 },
    { id: "qwen3-coder:480b", contextLength: 256_000 },
    { id: "nemotron-3-ultra", contextLength: 256_000 },
    { id: "glm-4.7", contextLength: 200_000 },
    { id: "qwen3-coder-next", contextLength: 256_000 },
    { id: "gpt-oss:120b", contextLength: 128_000 },
    { id: "minimax-m3", contextLength: 512_000 },
    { id: "nemotron-3-super", contextLength: 256_000 },
    { id: "gemma4:31b", contextLength: 256_000 },
    { id: "gpt-oss:20b", contextLength: 128_000 },
    { id: "qwen3-next:80b", contextLength: 256_000 },
  ],
  defaultModel: "devstral-2:123b",
  modelPreferences: [
    "devstral-2:123b",
    "qwen3-coder:480b",
    "nemotron-3-ultra",
    "qwen3-coder-next",
    "gpt-oss:120b",
  ],
} satisfies Provider;
