export type ServerConfig = {
  port: number;
  host: string;
};

const DEFAULT_PORT = 8153;
const DEFAULT_HOST = "127.0.0.1";

export function getServerConfig(overrides?: Partial<ServerConfig>): ServerConfig {
  return {
    port: overrides?.port ?? (Number(process.env.HIVE_PORT) || DEFAULT_PORT),
    host: overrides?.host ?? (process.env.HIVE_HOST || DEFAULT_HOST),
  };
}
