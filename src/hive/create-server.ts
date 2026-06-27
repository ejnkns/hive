import Fastify from "fastify";
import { logger } from "./shared/logger";
import fastifyWebsocket from "@fastify/websocket";
import FastifyVite from "@fastify/vite";
import { assignRoutes } from "./create-server/assign-routes";
import { ServerConfig } from "./server-config";

export async function createServer(): Promise<FastifyServer> {
  const server = await instantiateServer();
  await registerPlugins(server);
  assignRoutes(server);
  return server;
}

export async function instantiateServer() {
  return await Fastify({ logger: false });
}

export type FastifyServer = Awaited<ReturnType<typeof instantiateServer>>;

export function registerPlugins(server: FastifyServer) {
  return Promise.all([
    server.register(FastifyVite, {
      root: import.meta.dirname,
    }),
    server.register(fastifyWebsocket),
  ]);
}

export function listen(server: FastifyServer, config: ServerConfig) {
  server.listen({ port: config.port, host: config.host }, (err) => {
    if (err) {
      logger.error("failed to start server", err);
      process.exit(1);
    }
    logger.info(`listening on http://${config.host}:${String(config.port)}`);
  });
}
