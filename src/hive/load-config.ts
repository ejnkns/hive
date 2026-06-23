export type ProviderConfig = {
  name: string;
  baseUrl: string;
  apiKeyEnvVar: string;
  models: string[];
  defaultModel: string;
};

export type HiveConfig = {
  port: number;
  host: string;
  providers: ProviderConfig[];
};

const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    name: "groq",
    baseUrl: "https://api.groq.com/openai",
    apiKeyEnvVar: "GROQ_API_KEY",
    models: [
      "deepseek-r1-distill-llama-70b",
      "llama-3.3-70b-versatile",
      "mixtral-8x7b-32768",
    ],
    defaultModel: "deepseek-r1-distill-llama-70b",
  },
  {
    name: "sambanova",
    baseUrl: "https://api.sambanova.ai",
    apiKeyEnvVar: "SAMBA_NOVA_API_KEY",
    models: ["DeepSeek-R1", "Meta-Llama-3.3-70B-Instruct"],
    defaultModel: "DeepSeek-R1",
  },
  {
    name: "nvidia-nim",
    baseUrl: "https://integrate.api.nvidia.com",
    apiKeyEnvVar: "NVIDIA_NIM_API_KEY",
    models: [
      "meta/llama-3.3-70b-instruct",
      "nvidia/llama-3.1-nemotron-70b-instruct",
      "meta/llama-3.1-70b-instruct",
    ],
    defaultModel: "meta/llama-3.3-70b-instruct",
  },
  {
    name: "opencode-zen",
    baseUrl: "https://opencode.ai/zen",
    apiKeyEnvVar: "OPENCODE_ZEN_API_KEY",
    models: [
      "gpt-5.5",
      "gpt-5.5-pro",
      "gpt-5.4-mini",
      "deepseek-v4-flash-free",
      "qwen3.6-plus-free",
    ],
      defaultModel: "gpt-5.5",
    },
    {
      name: "google-ai",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKeyEnvVar: "GOOGLE_API_KEY",
      models: ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0-flash-exp"],
      defaultModel: "gemini-2.0-flash-exp",
    },
    {
      name: "github-models",
      baseUrl: "https://models.inference.ai.azure.com",
      apiKeyEnvVar: "GITHUB_TOKEN",
      models: [
        "gpt-4o",
        "gpt-4o-mini",
        "o1",
        "claude-3-5-sonnet",
        "llama-3.3-70b-instruct",
      ],
      defaultModel: "gpt-4o",
    },
  ];


export function loadConfig(): HiveConfig {
  return {
    port: Number(process.env.HIVE_PORT) || 19280,
    host: process.env.HIVE_HOST || "127.0.0.1",
    providers: [...DEFAULT_PROVIDERS],
  };
}
