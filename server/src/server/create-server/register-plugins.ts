import fastifyWebsocket from "@fastify/websocket";
import type { FastifyServer } from "../create-server.ts";

export async function registerPlugins(server: FastifyServer) {
  await server.register(fastifyWebsocket);
}
