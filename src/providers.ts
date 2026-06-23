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

import { groq } from "./providers/groq.js";
import { sambanova } from "./providers/sambanova.js";
import { nvidiaNim } from "./providers/nvidia-nim.js";
import { opencodeZen } from "./providers/opencode-zen.js";
import { googleAi } from "./providers/google-ai.js";
import { githubModels } from "./providers/github-models.js";

export const providers: Provider[] = [groq, sambanova, nvidiaNim, opencodeZen, googleAi, githubModels];

export { sortByPriority, updateScore } from "./providers/priority-queue.js";
