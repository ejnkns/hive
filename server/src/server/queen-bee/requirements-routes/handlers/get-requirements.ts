/** @private — only imported by register-routes.ts */

import type { FastifyReply, FastifyRequest } from "fastify";
import { readRequirements } from "../../requirements-store";
import type { RouteDeps } from "../types";

export function getRequirementsHandler(deps: RouteDeps) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId } = request.params as { projectId: string };

    const project = deps.projectStore.getAll().find((p) => p.id === projectId);
    if (!project) {
      return reply.status(404).send({ error: "Project not found" });
    }

    const content = readRequirements(project.repoPath);
    if (content) {
      return reply.send({ content });
    }
    return reply.status(404).send({ error: "Requirements not found" });
  };
}
