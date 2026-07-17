import type { SubScores } from "telemetry";
import { cerebras } from "./registry/cerebras";
import { deepseek } from "./registry/deepseek";
import { githubModels } from "./registry/github-models";
import { googleAi } from "./registry/google-ai";
import { groq } from "./registry/groq";
import { lmStudio } from "./registry/lm-studio";
import { mistral } from "./registry/mistral";
import { novita } from "./registry/novita";
import { nvidiaNim } from "./registry/nvidia-nim";
import { ollama } from "./registry/ollama";
import { omlx } from "./registry/omlx";
import { opencodeZen } from "./registry/opencode-zen";
import { openrouter } from "./registry/openrouter";
import { ovhcloud } from "./registry/ovhcloud";
import { routeway } from "./registry/routeway";
import { sambanova } from "./registry/sambanova";
import { scaleway } from "./registry/scaleway";

export type ModelEntry = string | { id: string; contextLength?: number };

export function getModelId(entry: ModelEntry): string {
  return typeof entry === "string" ? entry : entry.id;
}

export type Provider = {
  name: string;
  displayName: string;
  chatEndpoint: string;
  modelsEndpoint: string;
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
  deepseek,
  groq,
  sambanova,
  scaleway,
  nvidiaNim,
  opencodeZen,
  openrouter,
  googleAi,
  githubModels,
  cerebras,
  mistral,
  novita,
  omlx,
  ollama,
  ovhcloud,
  routeway,
  lmStudio,
].map((p) => ({
  ...p,
  chatEndpoint: p.chatEndpoint.replace(/\/+$/, ""),
  modelsEndpoint: p.modelsEndpoint.replace(/\/+$/, ""),
}));

