/** @private — only imported by queen-bee.ts */

import type { FastifyInstance } from "fastify";
import { getFlowRuntime } from "../flow-registry";
import { integrationIntegrate, integrationStatus } from "./project-lifecycle";
import { emitIntegrationChanged } from "./worker-event-bus";

export function registerIntegrationRoutes(server: FastifyInstance): void {
  server.get(
    "/api/queen-bee/:projectId/integration",
    async (request, reply) => {
      const flow = findFlow(
        (request.params as { projectId: string }).projectId
      );
      if (!flow) return reply.status(404).send({ error: "Project not found" });
      try {
        const result = integrationStatus(flow.repoPath, flow.targetBranch);
        if (!result.ok) {
          return reply.status(409).send({ error: result.error as string });
        }
        return reply.send({
          branchName: "hive-main",
          revision: result.integrationRevision as string,
          targetBranch: flow.targetBranch,
          targetRevision: result.targetRevision as string,
          state: result.state as string,
          ahead: result.ahead as number,
          behind: result.behind as number,
          canIntegrate: result.canIntegrate as boolean,
        });
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
        const result = integrationIntegrate(flow.repoPath, flow.targetBranch);
        if (!result.ok) {
          return reply.status(409).send({ error: result.error as string });
        }
        const statusResult = integrationStatus(
          flow.repoPath,
          flow.targetBranch
        );
        const integrationStatusData = {
          branchName: "hive-main" as const,
          revision: (statusResult.integrationRevision ??
            statusResult.revision) as string,
          targetBranch: flow.targetBranch,
          targetRevision: statusResult.targetRevision as string,
          state: statusResult.state as "integrated" | "ready" | "diverged",
          ahead: (statusResult.ahead as number) ?? 0,
          behind: (statusResult.behind as number) ?? 0,
          canIntegrate: (statusResult.canIntegrate as boolean) ?? false,
        };
        emitIntegrationChanged(integrationStatusData);
        return reply.send(integrationStatusData);
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
