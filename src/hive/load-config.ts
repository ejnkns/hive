import { allProviders } from "../providers/registry";
import { Provider } from "../providers/registry";

export type HiveConfig = {
  port: number;
  host: string;
  providers: Provider[];
};

export function loadConfig(): HiveConfig {
  return {
    port: Number(process.env.HIVE_PORT) || 19280,
    host: process.env.HIVE_HOST || "127.0.0.1",
    providers: [...allProviders],
  };
}
