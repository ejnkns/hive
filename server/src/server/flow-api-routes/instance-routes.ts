/** @private — per-instance REST routes: instances list, action dispatch,
 * instance-state patch, and task input. */

import type { FastifyInstance } from "fastify";
import { collectConfigFieldValues } from "workflow-engine/collect-config-field-values";
import { getFlowRuntime } from "../flow-registry";

export function registerInstanceRoutes(server: FastifyInstance): void {
  server.get("/api/flows/:flowId/instances", async (request, reply) => {
    // Fastify params type is erased; shape guaranteed by route pattern
    const { flowId } = request.params as { flowId: string };
    const runtime = getFlowRuntime(flowId);
    if (!runtime) {
      return reply.status(404).send({ error: "Flow not found" });
    }

    return reply.send({
      instances: runtime.getWorkflowInstanceEntries(),
    });
  });

  server.post(
    "/api/flows/:flowId/instances/:instanceId/action",
    async (request, reply) => {
      // Fastify params type is erased; shape guaranteed by route pattern
      const { flowId, instanceId } = request.params as {
        flowId: string;
        instanceId: string;
      };
      // Fastify body is unknown; validated below with typeof checks
      const body = request.body as Record<string, unknown> | null;

      const actionId = body?.actionId;
      if (typeof actionId !== "string") {
        return reply.status(400).send({ error: "actionId is required" });
      }

      const runtime = getFlowRuntime(flowId);
      if (!runtime) {
        return reply.status(404).send({ error: "Flow not found" });
      }

      const controller = runtime.getWorkflowInstance(instanceId);
      if (!controller) {
        return reply.status(404).send({ error: "Instance not found" });
      }

      const before = controller.getState().currentState;
      try {
        controller.dispatchAction(
          actionId,
          body?.payload !== null && typeof body?.payload === "object"
            ? (body.payload as Record<string, unknown>)
            : undefined
        );
      } catch (err) {
        // A fielded action with an invalid payload (unknown key, missing or
        // mistyped required field) is a client error, not a server bug.
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Invalid action payload",
        });
      }
      const after = controller.getState().currentState;

      if (before === after) {
        return reply.status(409).send({
          error: "Action rejected or unavailable",
          actionId,
        });
      }

      return reply.send({
        instanceId,
        previousState: before,
        currentState: after,
        state: controller.getState(),
        availableActions: controller.getAvailableActions(),
      });
    }
  );

  server.patch(
    "/api/flows/:flowId/instances/:instanceId/state",
    async (request, reply) => {
      // Fastify params type is erased; shape guaranteed by route pattern
      const { flowId, instanceId } = request.params as {
        flowId: string;
        instanceId: string;
      };
      const body = request.body as Record<string, unknown> | null;

      const runtime = getFlowRuntime(flowId);
      if (!runtime) {
        return reply.status(404).send({ error: "Flow not found" });
      }

      const controller = runtime.getWorkflowInstance(instanceId);
      if (!controller) {
        return reply.status(404).send({ error: "Instance not found" });
      }

      // The workflow's declared editFields are the exact contract: unknown
      // keys rejected, required fields present, values type-checked — through
      // the same shared validator action payloads use.
      const editFields = controller.getEditFields();
      if (editFields.length === 0) {
        return reply.status(400).send({ error: "Instance is not editable" });
      }

      const payload =
        body?.values !== null && typeof body?.values === "object"
          ? (body.values as Record<string, unknown>)
          : {};
      const collected = collectConfigFieldValues(editFields, payload);
      if (!collected.ok) {
        return reply.status(400).send({ error: collected.error });
      }

      controller.patchWorkflowInstanceState(collected.values);

      return reply.send({
        instanceId,
        state: controller.getState(),
        availableActions: controller.getAvailableActions(),
      });
    }
  );

  server.post(
    "/api/flows/:flowId/instances/:instanceId/task/input",
    async (request, reply) => {
      // Fastify params type is erased; shape guaranteed by route pattern
      const { flowId, instanceId } = request.params as {
        flowId: string;
        instanceId: string;
      };
      // Fastify body is unknown; validated below with typeof check
      const body = request.body as Record<string, unknown> | null;
      const content = body?.content;
      if (typeof content !== "string") {
        return reply.status(400).send({ error: "content is required" });
      }

      const runtime = getFlowRuntime(flowId);
      if (!runtime) {
        return reply.status(404).send({ error: "Flow not found" });
      }

      const controller = runtime.getWorkflowInstance(instanceId);
      if (!controller) {
        return reply.status(404).send({ error: "Instance not found" });
      }

      const state = controller.getState();
      if (!state.hasRunningTask) {
        return reply.status(409).send({
          error: "No running task on this instance",
        });
      }

      if (state.runningTaskContext?.role !== "ai-chat") {
        return reply.status(409).send({
          error: "Running task is not an ai-chat session",
          role: state.runningTaskContext?.role,
        });
      }

      const taskId = state.runningTaskId;
      if (!taskId) {
        return reply.status(409).send({ error: "No running task ID" });
      }

      controller.sendTaskInput(taskId, content, "user");

      return reply.send({
        sent: true,
        instanceId,
        runningTaskContext: controller.getState().runningTaskContext,
      });
    }
  );

  // ── Flow definition library ──
}
