import { groq } from "./groq.js";
import { sambanova } from "./sambanova.js";
import { nvidiaNim } from "./nvidia-nim.js";
import { opencodeZen } from "./opencode-zen.js";
import { googleAi } from "./google-ai.js";
import { githubModels } from "./github-models.js";

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
];
