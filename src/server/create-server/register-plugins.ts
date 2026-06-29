import fastifyWebsocket from "@fastify/websocket";
import { FastifyServer } from "../create-server";

export async function registerPlugins(server: FastifyServer) {
  await server.register(fastifyWebsocket);
}
