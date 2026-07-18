/** @private — only imported by queen-bee.ts */

import type { FastifyInstance } from "fastify";
import type { ProjectStore } from "./create-project-store";
import type { IntegrationManager } from "./integration-manager";

export function registerIntegrationRoutes(
  server: FastifyInstance,
  dependencies: {
    projectStore: ProjectStore;
    integrationManager: IntegrationManager;
  }
): void {
  const { projectStore, integrationManager } = dependencies;

  server.get(
    "/api/queen-bee/:projectId/integration",
    async (request, reply) => {
      const project = findProject(
        projectStore,
        (request.params as { projectId: string }).projectId
      );
      if (!project)
        return reply.status(404).send({ error: "Project not found" });
      try {
        return reply.send(
          integrationManager.status(project.repoPath, project.targetBranch)
        );
      } catch (error) {
        return reply.status(409).send({ error: errorMessage(error) });
      }
    }
  );

  server.post(
    "/api/queen-bee/:projectId/integration/integrate",
    async (request, reply) => {
      const project = findProject(
        projectStore,
        (request.params as { projectId: string }).projectId
      );
      if (!project)
        return reply.status(404).send({ error: "Project not found" });
      try {
        return reply.send(
          integrationManager.integrate(project.repoPath, project.targetBranch)
        );
      } catch (error) {
        return reply.status(409).send({ error: errorMessage(error) });
      }
    }
  );
}

function findProject(projectStore: ProjectStore, projectId: string) {
  return projectStore.getAll().find((project) => project.id === projectId);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Git integration failed";
}
