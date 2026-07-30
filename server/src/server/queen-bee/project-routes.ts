/** @private — only imported by queen-bee.ts */

import type { FastifyInstance } from "fastify";
import { isRecord } from "shared/board-types";
import type { FlowPersistence } from "workflow-engine/create-flow-runtime";
import {
  createFlowOnLink,
  getAllFlows,
  getFlowRuntime,
  unlinkFlow,
} from "../flow-registry";
import type { ProjectStore } from "./create-project-store";

export function registerProjectRoutes(
  server: FastifyInstance,
  store: ProjectStore,
  persistence?: FlowPersistence
): void {
  server.get("/api/queen-bee/projects", async (_request, reply) => {
    const storeProjects = store.getAll();
    const flowProjects = getAllFlows();
    const merged = storeProjects.map((p) => {
      const flow = flowProjects.find((f) => f.id === p.id);
      return flow ?? p;
    });
    return reply.send({ projects: merged });
  });

  server.post("/api/queen-bee/projects", async (request, reply) => {
    const body = isRecord(request.body) ? request.body : {};

    if (!body.path || typeof body.path !== "string") {
      return reply.status(400).send({ error: "path is required" });
    }

    try {
      const project = store.create(
        body.path,
        typeof body.name === "string" ? body.name : undefined
      );

      if (persistence) {
        createFlowOnLink(project.id, project.repoPath, persistence, {
          name: project.name,
          targetBranch: project.targetBranch,
          maxConcurrentWorkers: project.maxConcurrentWorkers,
        });
      }

      return reply.status(201).send({ project });
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
      try {
        const project = store.updateMaxConcurrentWorkers(
          params.projectId,
          body.maxConcurrentWorkers
        );
        const runtime = getFlowRuntime(params.projectId);
        if (runtime) {
          runtime.patchFlowConfig({
            maxConcurrentWorkers: body.maxConcurrentWorkers,
          });
        }
        return reply.send({ project });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Invalid project config";
        return reply
          .status(message === "Project not found" ? 404 : 400)
          .send({ error: message });
      }
    }
  );

  server.delete(
    "/api/queen-bee/projects/:projectId",
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };

      try {
        store.unlink(projectId);
        unlinkFlow(projectId);
        return reply.send({ ok: true });
      } catch (err) {
        return reply.status(404).send({
          error: err instanceof Error ? err.message : "Project not found",
        });
      }
    }
  );
}
