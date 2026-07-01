import Fastify from "fastify";
import { logger } from "../shared/logger";
import type { ServerConfig } from "../shared/server-config";
import { assignRoutes, type RouteDeps } from "./create-server/assign-routes";
import { registerPlugins } from "./create-server/register-plugins";

export async function createServer(deps: RouteDeps): Promise<FastifyServer> {
  const server = await instantiateServer();
  await registerPlugins(server);
  assignRoutes(server, deps);
  return server;
}

export function listen(server: FastifyServer, config: ServerConfig) {
  server.listen({ port: config.port, host: config.host }, (err) => {
    if (err) {
      logger.error("failed to start server", err);
      process.exit(1);
    }
    logger.info(`started at: http://${config.host}:${String(config.port)}`);
  });
}

export type FastifyServer = Awaited<ReturnType<typeof instantiateServer>>;
async function instantiateServer() {
  return await Fastify({ logger: false });
}
