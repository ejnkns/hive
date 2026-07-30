/** @private — only imported by queen-bee.ts */

import type { FastifyInstance } from "fastify";
import { getFlowRuntime } from "../flow-registry";
import type { IntegrationManager } from "./integration-manager";
import { emitIntegrationChanged } from "./worker-event-bus";

export function registerIntegrationRoutes(
  server: FastifyInstance,
  dependencies: {
    integrationManager: IntegrationManager;
  }
): void {
  const { integrationManager } = dependencies;

  server.get(
    "/api/queen-bee/:projectId/integration",
    async (request, reply) => {
      const flow = findFlow(
        (request.params as { projectId: string }).projectId
      );
      if (!flow) return reply.status(404).send({ error: "Project not found" });
      try {
        return reply.send(
          integrationManager.status(flow.repoPath, flow.targetBranch)
        );
      } catch (error) {
        return reply.status(409).send({ error: errorMessage(error) });
      }
    }
  );

  server.post(
    "/api/queen-bee/:projectId/integration/integrate",
    async (request, reply) => {
      const flow = findFlow(
        (request.params as { projectId: string }).projectId
      );
      if (!flow) return reply.status(404).send({ error: "Project not found" });
      try {
        const status = integrationManager.integrate(
          flow.repoPath,
          flow.targetBranch
        );
        emitIntegrationChanged(status);
        return reply.send(status);
      } catch (error) {
        return reply.status(409).send({ error: errorMessage(error) });
      }
    }
  );
}

function findFlow(flowId: string): {
  repoPath: string;
  targetBranch: string;
} | null {
  const runtime = getFlowRuntime(flowId);
  if (!runtime) return null;
  const config = runtime.getFlowConfig() as Record<string, unknown>;
  return {
    repoPath: (config.repoPath as string) ?? "",
    targetBranch: (config.targetBranch as string) ?? "main",
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Git integration failed";
}
