import { cerebras } from "./registry/cerebras.ts";
import { deepseek } from "./registry/deepseek.ts";
import { githubModels } from "./registry/github-models.ts";
import { googleAi } from "./registry/google-ai.ts";
import { groq } from "./registry/groq.ts";
import { lmStudio } from "./registry/lm-studio.ts";
import { mistral } from "./registry/mistral.ts";
import { novita } from "./registry/novita.ts";
import { nvidiaNim } from "./registry/nvidia-nim.ts";
import { ollama } from "./registry/ollama.ts";
import { ollamaCloud } from "./registry/ollama-cloud.ts";
import { omlx } from "./registry/omlx.ts";
import { opencodeZen } from "./registry/opencode-zen.ts";
import { openrouter } from "./registry/openrouter.ts";
import { ovhcloud } from "./registry/ovhcloud.ts";
import { routeway } from "./registry/routeway.ts";
import { sambanova } from "./registry/sambanova.ts";
import { scaleway } from "./registry/scaleway.ts";

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
  ollamaCloud,
  ovhcloud,
  routeway,
  lmStudio,
].map((p) => ({
  ...p,
  chatEndpoint: p.chatEndpoint.replace(/\/+$/, ""),
  modelsEndpoint: p.modelsEndpoint.replace(/\/+$/, ""),
}));
