import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import type { Card } from "./board-store";
import type { ProjectStore } from "./create-project-store";
import { registerWorkerRoutes, toWorkerSocketMessage } from "./worker-routes";
import type { WorkerSupervisor } from "./worker-supervisor";

describe("worker route events", () => {
  it("preserves the unfulfillable handover event contract", () => {
    assert.deepEqual(
      toWorkerSocketMessage(
        {
          type: "unfulfillable_handover",
          cardId: "card-1",
          content: "Requirements conflict",
          suggestions: ["Revise the requirement"],
        },
        "project-1"
      ),
      {
        type: "unfulfillable_handover",
        data: {
          projectId: "project-1",
          cardId: "card-1",
          content: "Requirements conflict",
          suggestions: ["Revise the requirement"],
          error: null,
        },
      }
    );
  });
});

describe("worker run admission", () => {
  const servers: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it("requires explicit confirmation before overlapping a running card", async () => {
    const target = card("target", ["src/shared.ts"]);
    const active = card("active", ["src/shared.ts"], "in_progress");
    const server = Fastify();
    servers.push(server);
    await server.register(websocket);
    const runs: string[] = [];
    const workerSupervisor = supervisor([active.id], runs);
    const projectStore: ProjectStore = {
      getAll: () => [
        {
          id: "project-1",
          name: "Project",
          repoPath: "/tmp/project-1",
          createdAt: "",
          systemPrompt: "",
          codingGuidelines: "",
          targetBranch: "main",
          maxConcurrentWorkers: 3,
        },
      ],
      create: () => {
        throw new Error("Not used");
      },
      unlink: () => {},
    };
    registerWorkerRoutes(server, {
      workerSupervisor,
      boardStore: {
        getBoard: () => ({ projectId: "project-1", cards: [target, active] }),
        addCard: () => {
          throw new Error("Not used");
        },
        moveCard: () => {
          throw new Error("Not used");
        },
        updateCard: () => {
          throw new Error("Not used");
        },
        archiveCard: () => {
          throw new Error("Not used");
        },
        saveCards: () => {},
      },
      projectStore,
      onWorkerEvent: () => {},
    });

    const blocked = await server.inject({
      method: "POST",
      url: "/api/queen-bee/project-1/cards/target/run",
    });
    assert.equal(blocked.statusCode, 409);
    assert.equal(blocked.json().admission.canOverride, true);
    assert.deepEqual(runs, []);

    const confirmed = await server.inject({
      method: "POST",
      url: "/api/queen-bee/project-1/cards/target/run",
      payload: { confirmRisks: true },
    });
    assert.equal(confirmed.statusCode, 200);
    assert.deepEqual(runs, ["project-1:target"]);
  });
});

function card(
  id: string,
  relevantFiles: string[],
  column: Card["column"] = "ready"
): Card {
  return {
    id,
    title: id,
    description: `${id} description`,
    acceptanceCriteria: [`${id} works`],
    relevantFiles,
    dependencies: [],
    column,
    createdAt: "2026-07-19T00:00:00.000Z",
  };
}

function supervisor(running: string[], runs: string[]): WorkerSupervisor {
  return {
    async run(projectId, card) {
      runs.push(`${projectId}:${card.id}`);
    },
    isRunning: () => false,
    runningCardIds: () => running,
    cancel: () => false,
  };
}
