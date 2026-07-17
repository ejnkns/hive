import type { Provider } from "../registry";

export const novita = {
  name: "novita",
  displayName: "Novita AI",
  chatEndpoint: "https://api.novita.ai/openai/v1/chat/completions",
  modelsEndpoint: "https://api.novita.ai/openai/v1/models",
  apiKeyEnvVar: "NOVITA_API_KEY",
  models: [
    { id: "qwen/qwen3.6-plus", contextLength: 1_000_000 },
    { id: "qwen/qwen3.5-plus", contextLength: 1_000_000 },
    { id: "nex-agi/nex-n2-pro", contextLength: 262_000 },
    { id: "minimax/m2-her", contextLength: 66_000 },
  ],
  defaultModel: "qwen/qwen3.6-plus",
  modelPreferences: [
    "qwen/qwen3.6-plus",
    "qwen/qwen3.5-plus",
    "nex-agi/nex-n2-pro",
  ],
} satisfies Provider;
