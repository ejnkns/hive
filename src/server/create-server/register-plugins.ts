import fastifyWebsocket from "@fastify/websocket";
import { FastifyServer } from "../create-server";
import FastifyVite from "@fastify/vite";

export function registerPlugins(server: FastifyServer) {
  return Promise.all([
    server.register(FastifyVite, {
      root: import.meta.dirname,
    }),
    server.register(fastifyWebsocket),
  ]);
}
