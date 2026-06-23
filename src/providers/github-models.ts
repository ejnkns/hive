export const githubModels = {
  name: 'github-models',
  baseUrl: 'https://models.inference.ai.azure.com',
  apiKeyEnvVar: 'GITHUB_TOKEN',
  models: ['gpt-4o', 'gpt-4o-mini', 'o1', 'claude-3-5-sonnet', 'llama-3.3-70b-instruct'],
  defaultModel: 'gpt-4o',
}
