import { allProviders } from "../providers/registry";
import { Provider } from "../providers/registry";
import { loadModelCacheSync } from "../providers/discovery";

export type HiveConfig = {
  port: number;
  host: string;
  providers: Provider[];
};

export function loadConfig(): HiveConfig {
  const cache = loadModelCacheSync();
  const providers = allProviders.map((p) => {
    const cached = cache?.providers.find((cp) => cp.name === p.name);
    return {
      name: p.name,
      baseUrl: p.baseUrl,
      apiKeyEnvVar: p.apiKeyEnvVar,
      models: cached ? [...cached.models] : [...p.models],
      defaultModel: cached ? cached.defaultModel : p.defaultModel,
    };
  });

  return {
    port: Number(process.env.HIVE_PORT) || 19280,
    host: process.env.HIVE_HOST || "127.0.0.1",
    providers,
  };
}
