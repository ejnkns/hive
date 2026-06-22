export const nvidiaNim = {
  name: "nvidia-nim",
  baseUrl: "https://integrate.api.nvidia.com",
  apiKeyEnvVar: "NVIDIA_NIM_API_KEY",
  models: [
    "meta/llama-3.3-70b-instruct",
    "nvidia/llama-3.1-nemotron-70b-instruct",
    "meta/llama-3.1-70b-instruct",
  ],
  defaultModel: "meta/llama-3.3-70b-instruct",
};
