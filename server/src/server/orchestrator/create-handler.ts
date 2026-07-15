/** @internal — wiring for the /api/orchestrate endpoint */

import { logger } from "shared/logger";
import type { Message } from "shared/message";
import type { Provider } from "../providers";
import { createLocalToolRegistry } from "./create-local-tool-registry";
import { createHandleChatCompletionCaller } from "./handle-chat-completion-caller";
import { orchestrate } from "./orchestrate";
import type { OrchestrationEvent, OrchestrationResult } from "./types";

export type HandleOrchestrate = (
  body: Record<string, unknown>,
  headers: Record<string, string | string[] | undefined>,
  onEvent?: (event: OrchestrationEvent) => void
) => Promise<OrchestrationResult>;

type OrchestratorHandlerConfig = {
  getProviders: () => ReadonlyArray<Provider>;
  workspacePath: string;
};

export function createOrchestratorHandler(
  config: OrchestratorHandlerConfig
): HandleOrchestrate {
  return async (body, headers, onEvent) => {
    const messages = (body.messages as Message[]) ?? [];
    const sessionId =
      (headers["x-session-id"] as string) ??
      (headers["x-session-affinity"] as string) ??
      "orchestrator-default";

    const modelCaller = createHandleChatCompletionCaller();

    const toolRegistry = createLocalToolRegistry({
      workspacePath: config.workspacePath,
    });

    const maxIterations =
      typeof body.max_iterations === "number" ? body.max_iterations : undefined;

    logger.debug(`orchestrate — session ${sessionId}`);

    return orchestrate(
      {
        messages,
        toolRegistry,
        toolContext: { sessionId, workspacePath: config.workspacePath },
        maxIterations,
        sessionId,
        onEvent,
      },
      modelCaller
    );
  };
}
