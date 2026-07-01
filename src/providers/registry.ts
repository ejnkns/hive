import type { SubScores } from "../telemetry";
import { cerebras } from "./registry/cerebras";
import { githubModels } from "./registry/github-models";
import { googleAi } from "./registry/google-ai";
import { groq } from "./registry/groq";
import { lmStudio } from "./registry/lm-studio";
import { mistral } from "./registry/mistral";
import { nvidiaNim } from "./registry/nvidia-nim";
import { ollama } from "./registry/ollama";
import { omlx } from "./registry/omlx";
import { opencodeZen } from "./registry/opencode-zen";
import { sambanova } from "./registry/sambanova";

export type ModelEntry = string | { id: string; contextLength?: number };

export function getModelId(entry: ModelEntry): string {
  return typeof entry === "string" ? entry : entry.id;
}

export type Provider = {
  name: string;
  displayName: string;
  baseUrl: string;
  apiKeyEnvVar: string;
  models: ModelEntry[];
  defaultModel: string;
  modelPreferences?: string[];
};

export type ProviderState = {
  provider: string;
  model: string;
  enabled: boolean;
  stabilityScore: number;
  subscores: SubScores;
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
