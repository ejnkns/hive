import { groq } from "./groq";
import { sambanova } from "./sambanova";
import { nvidiaNim } from "./nvidia-nim";
import { opencodeZen } from "./opencode-zen";
import { googleAi } from "./google-ai";
import { githubModels } from "./github-models";
import { cerebras } from "./cerebras";
import { mistral } from "./mistral";

export type Provider = {
  name: string;
  baseUrl: string;
  apiKeyEnvVar: string;
  models: string[];
  defaultModel: string;
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
