export type ServerConfig = {
  port: number;
  host: string;
};

const DEFAULT_PORT = 8153;
const DEFAULT_HOST = "127.0.0.1";

export const SERVER_CONFIG: ServerConfig = {
  port: DEFAULT_PORT,
  host: DEFAULT_HOST,
};
