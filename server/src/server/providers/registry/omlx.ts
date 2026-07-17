import type { Provider } from "../registry";

export const omlx = {
  name: "omlx",
  displayName: "oMLX",
  chatEndpoint: (process.env.OMLX_HOST || "http://127.0.0.1:8000/v1") + "/chat/completions",
  modelsEndpoint: (process.env.OMLX_HOST || "http://127.0.0.1:8000/v1") + "/models",
  apiKeyEnvVar: "OMLX_API_KEY",
  models: ["gpt-oss-20b-MXFP4-Q8"],
  defaultModel: "gpt-oss-20b-MXFP4-Q8",
  modelPreferences: ["gpt-oss-20b-MXFP4-Q8"],
} satisfies Provider;
