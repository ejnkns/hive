import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import type { ProjectListItem } from "shared/project-types";
import { registerBoardRoutes } from "./board-routes";
import { type Column, createBoardStore } from "./board-store";
import type { ProjectStore } from "./create-project-store";
import type { Planner } from "./planner";

describe("board routes", () => {
  const directories: string[] = [];
  const servers: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("allows only Idea to Ready through the manual move endpoint", async () => {
    const { server, boardStore, project } = createRouteFixture();
    const allowedCard = boardStore.addCard(project.id, project.repoPath, {
      title: "Confirmed idea",
      description: "Requirements are aligned",
      acceptanceCriteria: ["The user confirmed the requirements"],
      relevantFiles: ["source.ts"],
      dependencies: [],
      column: "idea",
    });

    const response = await server.inject({
      method: "PATCH",
      url: `/api/queen-bee/${project.id}/cards/${allowedCard.id}`,
      payload: { column: "ready" },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().card.column, "ready");
  });

  it("rejects manual moves owned by worker lifecycle actions", async () => {
    const { server, boardStore, project } = createRouteFixture();
    const transitions: Array<{ from: Column; to: Column }> = [
      { from: "idea", to: "in_progress" },
      { from: "idea", to: "reviewing" },
      { from: "idea", to: "done" },
      { from: "idea", to: "unfulfillable" },
      { from: "ready", to: "in_progress" },
      { from: "ready", to: "reviewing" },
      { from: "done", to: "idea" },
    ];

    for (const [index, transition] of transitions.entries()) {
      const card = boardStore.addCard(project.id, project.repoPath, {
        title: `Invalid transition ${String(index)}`,
        description: "Requirements exist",
        acceptanceCriteria: ["Lifecycle ownership is enforced"],
        relevantFiles: ["source.ts"],
        dependencies: [],
        column: transition.from,
      });
      const response = await server.inject({
        method: "PATCH",
        url: `/api/queen-bee/${project.id}/cards/${card.id}`,
        payload: { column: transition.to },
      });

      assert.equal(
        response.statusCode,
        400,
        `${transition.from} -> ${transition.to} should be rejected`
      );
      assert.equal(
        boardStore
          .getBoard(project.id, project.repoPath)
          .cards.find((candidate) => candidate.id === card.id)?.column,
        transition.from
      );
    }
  });

  it("rejects unknown columns instead of silently moving to Idea", async () => {
    const { server, boardStore, project } = createRouteFixture();
    const card = boardStore.addCard(project.id, project.repoPath, {
      title: "Keep current state",
      description: "Requirements exist",
      acceptanceCriteria: ["Invalid input is rejected"],
      relevantFiles: ["source.ts"],
      dependencies: [],
      column: "ready",
    });

    const response = await server.inject({
      method: "PATCH",
      url: `/api/queen-bee/${project.id}/cards/${card.id}`,
      payload: { column: "unknown" },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(
      boardStore.getBoard(project.id, project.repoPath).cards[0]?.column,
      "ready"
    );
  });

  function createRouteFixture() {
    const repoPath = mkdtempSync(join(tmpdir(), "hive-board-routes-"));
    directories.push(repoPath);
    const project: ProjectListItem = {
      id: "project-1",
      name: "Project",
      repoPath,
      createdAt: "",
      systemPrompt: "",
      codingGuidelines: "",
    };
    const projectStore: ProjectStore = {
      getAll: () => [project],
      create: () => {
        throw new Error("Not used");
      },
      unlink: () => {},
    };
    const boardStore = createBoardStore(() => {});
    const planner: Planner = { plan: async () => [] };
    const server = Fastify();
    servers.push(server);
    registerBoardRoutes(server, { boardStore, planner, projectStore });
    return { server, boardStore, project };
  }
});
