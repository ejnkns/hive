/** @public — the flow API HTTP surface: Fastify route registration for flows,
 * workflow instances, definitions, and the realtime websocket. Import from
 * here, not from flow-api-routes/ directly.
 *
 * The routes are grouped per resource in flow-api-routes/: the whole-flow
 * snapshot payload (flow-payload), flow-level routes (flows-routes),
 * per-instance routes (instance-routes), definition + authoring routes
 * (definition-routes), and the realtime endpoint (websocket-routes). */

import type { FastifyInstance } from "fastify";
import { registerDefinitionRoutes } from "./flow-api-routes/definition-routes.ts";
import { registerFlowsRoutes } from "./flow-api-routes/flows-routes.ts";
import { registerInstanceRoutes } from "./flow-api-routes/instance-routes.ts";
import { registerWebsocketRoutes } from "./flow-api-routes/websocket-routes.ts";

export function registerFlowApiRoutes(server: FastifyInstance): void {
  registerFlowsRoutes(server);
  registerInstanceRoutes(server);
  registerDefinitionRoutes(server);
  registerWebsocketRoutes(server);
}
