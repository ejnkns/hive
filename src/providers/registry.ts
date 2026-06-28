import { groq } from "./registry/groq";
import { sambanova } from "./registry/sambanova";
import { nvidiaNim } from "./registry/nvidia-nim";
import { opencodeZen } from "./registry/opencode-zen";
import { googleAi } from "./registry/google-ai";
import { githubModels } from "./registry/github-models";
import { mistral } from "./registry/mistral";
import { omlx } from "./registry/omlx";
import { ollama } from "./registry/ollama";
import { lmStudio } from "./registry/lm-studio";
import { cerebras } from "./registry/cerebras";

export type Provider = {
  name: string;
  displayName: string;
  baseUrl: string;
  apiKeyEnvVar: string;
  models: string[];
  defaultModel: string;
  modelPreferences?: string[];
};

export type ProviderState = {
  provider: string;
  model: string;
  enabled: boolean;
  stabilityScore: number;
};

export const allProviders: Provider[] = [
  groq,
  sambanova,
  nvidiaNim,
  opencodeZen,
  googleAi,
  githubModels,
  cerebras,
  mistral,
  omlx,
  ollama,
  lmStudio,
].map((p) => ({
  ...p,
  baseUrl: p.baseUrl.replace(/\/+$/, ""),
}));

export function buildChatEndpoint(baseUrl: string): string {
  if (/\/v\d/.test(baseUrl)) {
    return `${baseUrl}/chat/completions`;
  }
  return `${baseUrl}/v1/chat/completions`;
}

export function buildModelsEndpoint(baseUrl: string): string {
  if (/\/v\d/.test(baseUrl)) {
    return `${baseUrl}/models`;
  }
  return `${baseUrl}/v1/models`;
}
