/** @private — only imported by queen-bee.ts */

import type { FastifyInstance } from "fastify";
import { isRecord } from "shared/board-types";
import { isMaxConcurrentWorkers } from "shared/project-types";
import type { FlowPersistence } from "workflow-engine/create-flow-runtime";
import { getAllFlows, getFlowRuntime, unlinkFlow } from "../flow-registry";
import { createFlowForRepo } from "./project-lifecycle";

export function registerProjectRoutes(
  server: FastifyInstance,
  persistence?: FlowPersistence
): void {
  server.get("/api/queen-bee/projects", async (_request, reply) => {
    return reply.send({ projects: getAllFlows() });
  });

  server.post("/api/queen-bee/projects", async (request, reply) => {
    const body = isRecord(request.body) ? request.body : {};

    if (!body.path || typeof body.path !== "string") {
      return reply.status(400).send({ error: "path is required" });
    }

    try {
      if (!persistence) {
        return reply
          .status(500)
          .send({ error: "Flow persistence not available" });
      }
      const flow = createFlowForRepo(
        body.path,
        persistence,
        typeof body.name === "string" ? body.name : undefined
      );
      return reply.status(201).send({ project: flow });
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : "Invalid project",
      });
    }
  });

  server.patch(
    "/api/queen-bee/projects/:projectId/config",
    async (request, reply) => {
      const params = isRecord(request.params) ? request.params : {};
      const body = isRecord(request.body) ? request.body : {};
      if (typeof params.projectId !== "string") {
        return reply.status(400).send({ error: "projectId is required" });
      }
      if (typeof body.maxConcurrentWorkers !== "number") {
        return reply
          .status(400)
          .send({ error: "maxConcurrentWorkers must be a number" });
      }
      if (!isMaxConcurrentWorkers(body.maxConcurrentWorkers)) {
        return reply.status(400).send({
          error: "Parallel workers must be an integer from 1 to 16",
        });
      }

      const runtime = getFlowRuntime(params.projectId);
      if (!runtime) {
        return reply.status(404).send({ error: "Project not found" });
      }

      runtime.patchFlowConfig({
        maxConcurrentWorkers: body.maxConcurrentWorkers,
      });

      const config = runtime.getFlowConfig() as Record<string, unknown>;
      return reply.send({
        project: {
          id: params.projectId,
          repoPath: config.repoPath as string,
          name: config.name as string,
          targetBranch: config.targetBranch as string,
          maxConcurrentWorkers: body.maxConcurrentWorkers,
        },
      });
    }
  );

  server.delete(
    "/api/queen-bee/projects/:projectId",
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };

      const runtime = getFlowRuntime(projectId);
      if (!runtime) {
        return reply.status(404).send({ error: "Project not found" });
      }

      unlinkFlow(projectId);
      return reply.send({ ok: true });
    }
  );
}
