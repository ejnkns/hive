import { printBanner } from "shared/ascii-banner";
import { logger } from "shared/logger";
import { getServerConfig, type ServerConfig } from "shared/server-config";
import { registerFlowApiRoutes } from "../server/flow-api-routes.ts";
import { loadUserDefinitionsFromDisk } from "../server/flow-definitions.ts";
import { createFlowPersistence } from "../server/flow-persistence.ts";
import { rehydrateFlow, setFlowPersistence } from "../server/flow-registry.ts";
import { loadModelPriority } from "../server/proxy/model-priority-config.ts";
import {
  getLastUsed,
  getProviderStates,
  getProviders,
  handleChatCompletion,
  initServerState,
  shutdown,
  start,
} from "../server/proxy.ts";
import {
  createServer,
  getOverride,
  isProviderDisabled,
  listen,
  loadProviders,
} from "../server.ts";
import { registerBuiltinFlowDefinitions } from "./register-builtin-flow-definitions.ts";

export async function startServer(overrides?: Partial<ServerConfig>) {
  printBanner();

  const config = getServerConfig(overrides);

  initServerState({
    getOverride,
    isProviderDisabled,
    getProviders: loadProviders,
  });

  loadModelPriority();

  start();

  const server = await createServer({
    getProviders: () => getProviders(),
    getProviderStates: () => getProviderStates(),
    getLastUsed: () => getLastUsed(),
    handleChatCompletion: (body, headers, signal) =>
      handleChatCompletion(body, headers, signal),
  });

  // ── Flow persistence & rehydration ──

  // Register built-in flow definitions before rehydration so persisted flows
  // can rebuild their runtimes from the definition registry. The server does
  // not know what any preset is; it just loads the definitions it ships.
  await registerBuiltinFlowDefinitions();
  await loadUserDefinitionsFromDisk();

  const persistence = createFlowPersistence();
  setFlowPersistence(persistence);
  const flows = persistence.loadAllFlows();

  for (const {
    flowId,
    config: flowConfig,
    state: flowState,
    instances,
  } of flows) {
    // One un-rehydratable flow must not kill the boot: a definition or
    // persisted-state problem in a single flow logs a warning and is skipped,
    // the rest of the flows still come up. rehydrateFlow already rejects the
    // known invalid-config case (persist tasks without a basePath); this
    // guard is the safety net for anything else.
    try {
      await rehydrateFlow(
        persistence,
        flowId,
        flowConfig,
        flowState,
        instances
      );
    } catch (err) {
      logger.warn(
        `Flow "${flowId}" failed to rehydrate, skipping: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  registerFlowApiRoutes(server);

  listen(server, config);

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      shutdown();
      // Bound the graceful close: Fastify's close() waits for open
      // connections, and in the dev loop a browser WS/SSE would keep the
      // dying process alive and wedge the port for the rebuilt server.
      const deadline = setTimeout(() => process.exit(0), 3_000);
      deadline.unref();
      server.close(() => process.exit(0));
      server.server.closeIdleConnections();
    });
  }

  // A dev server that dies silently is undiagnosable. Log async failures
  // instead of letting Node's default crash-and-print-nothing behavior take
  // over: unhandled rejections are logged and the server keeps running;
  // uncaught exceptions are logged before the process exits.
  process.on("unhandledRejection", (reason) => {
    logger.error(
      "Unhandled promise rejection — server continues",
      reason instanceof Error ? reason : new Error(String(reason))
    );
  });
  process.on("uncaughtException", (err) => {
    logger.error("Uncaught exception — server exiting", err);
    process.exit(1);
  });

  return { server };
}
