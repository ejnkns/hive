export type ServerConfig = {
  port: number;
  host: string;
};

const DEFAULT_PORT = 8153;
const DEFAULT_HOST = "127.0.0.1";

function getEnvPort(): number {
  if (typeof process === "undefined" || !process.env) return DEFAULT_PORT;
  return Number(process.env.HIVE_PORT) || DEFAULT_PORT;
}

function getEnvHost(): string {
  if (typeof process === "undefined" || !process.env) return DEFAULT_HOST;
  return process.env.HIVE_HOST || DEFAULT_HOST;
}

export function getServerConfig(overrides?: Partial<ServerConfig>): ServerConfig {
  return {
    port: overrides?.port ?? getEnvPort(),
    host: overrides?.host ?? getEnvHost(),
  };
}
