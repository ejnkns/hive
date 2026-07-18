import assert from "node:assert";
import { describe, it } from "node:test";
import { initServerState } from "../server-state";
import { validateProvidersOnStartup } from "./validate-providers-on-startup";

function createProvider(name: string, model: string, apiKeyEnvVar: string) {
  return {
    name,
    displayName: name,
    chatEndpoint: "https://api.example.com/chat",
    modelsEndpoint: "https://api.example.com/models",
    apiKeyEnvVar,
    models: [model],
    defaultModel: model,
  };
}

await describe("validateProvidersOnStartup", async () => {
  await it("does not throw when no providers are configured", () => {
    initServerState({
      getOverride: () => null,
      isProviderDisabled: () => false,
      getProviders: () => [],
    });

    assert.doesNotThrow(() => {
      validateProvidersOnStartup();
    });
  });

  await it("skips providers that have no API key in the environment", () => {
    initServerState({
      getOverride: () => null,
      isProviderDisabled: () => false,
      getProviders: () => [
        createProvider("no-key-provider", "model-a", "NONEXISTENT_ENV_VAR"),
        createProvider("also-no-key", "model-b", "ALSO_MISSING"),
      ],
    });

    assert.doesNotThrow(() => {
      validateProvidersOnStartup();
    });
  });
});
