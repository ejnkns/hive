import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import type { ProjectListItem } from "shared/project-types";
import { createBoardStore } from "./board-store";
import type { ProjectStore } from "./create-project-store";
import type { DeviseEngine } from "./devise-engine";
import { registerDeviseRoutes } from "./devise-routes";

describe("devise routes", () => {
  const directories: string[] = [];
  const servers: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("requires explicit confirmation before revising around active work", async () => {
    let starts = 0;
    const { server, boardStore, project } = createRouteFixture({
      async start() {
        starts += 1;
        return { question: "What should change?" };
      },
    });
    boardStore.addCard(project.id, project.repoPath, {
      title: "Active card",
      description: "Work is underway",
      acceptanceCriteria: ["The worker is active"],
      relevantFiles: [],
      dependencies: [],
      column: "in_progress",
    });

    const blocked = await server.inject({
      method: "POST",
      url: `/api/queen-bee/${project.id}/devise/redevise/start`,
      payload: { prompt: "Change the scope" },
    });
    assert.equal(blocked.statusCode, 409);
    assert.equal(blocked.json().requiresConfirmation, true);
    assert.equal(starts, 0);

    const confirmed = await server.inject({
      method: "POST",
      url: `/api/queen-bee/${project.id}/devise/redevise/start`,
      payload: { prompt: "Change the scope", confirmActive: true },
    });
    assert.equal(confirmed.statusCode, 200);
    assert.equal(starts, 1);
  });

  it("keeps a refined card in Idea until the user confirms promotion", async () => {
    const { server, boardStore, project } = createRouteFixture({
      async respondCard() {
        return {
          type: "complete" as const,
          spec: [
            "CARD_UPDATE",
            "```json",
            JSON.stringify({
              description: "Refined description",
              acceptanceCriteria: ["Refined behavior is verified"],
              relevantFiles: ["src/refined.ts"],
              requirementRefs: ["FR-2"],
            }),
            "```",
          ].join("\n"),
        };
      },
      getCardSession() {
        return requirementsUpdatedSession();
      },
    });
    const card = boardStore.addCard(project.id, project.repoPath, {
      title: "New idea",
      description: "",
      acceptanceCriteria: [],
      relevantFiles: [],
      dependencies: [],
      column: "idea",
    });

    const response = await server.inject({
      method: "POST",
      url: `/api/queen-bee/${project.id}/cards/${card.id}/devise/respond`,
      payload: { answer: "That covers it" },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().complete, true);
    assert.equal(response.json().card.description, "Refined description");
    assert.equal(response.json().card.column, "idea");
    assert.equal(
      boardStore
        .getBoard(project.id, project.repoPath)
        .cards.find((candidate) => candidate.id === card.id)?.column,
      "idea"
    );
  });

  it("rejects a card update when requirements were not updated", async () => {
    const { server, boardStore, project } = createRouteFixture({
      async respondCard() {
        return {
          type: "complete" as const,
          spec: 'CARD_UPDATE\n```json\n{"description":"Card only"}\n```',
        };
      },
    });
    const card = boardStore.addCard(project.id, project.repoPath, {
      title: "Keep requirements aligned",
      description: "",
      acceptanceCriteria: [],
      relevantFiles: [],
      dependencies: [],
      column: "idea",
    });

    const response = await server.inject({
      method: "POST",
      url: `/api/queen-bee/${project.id}/cards/${card.id}/devise/respond`,
      payload: { answer: "Done" },
    });

    assert.equal(response.statusCode, 422);
    assert.match(response.json().error, /requirements/i);
    assert.equal(
      boardStore.getBoard(project.id, project.repoPath).cards[0]?.description,
      ""
    );
  });

  function createRouteFixture(overrides: Partial<DeviseEngine> = {}) {
    const repoPath = mkdtempSync(join(tmpdir(), "hive-devise-routes-"));
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
    const engine: DeviseEngine = {
      start: async () => ({ question: "Question" }),
      respond: async () => ({ type: "question", question: "Question" }),
      getSession: () => undefined,
      startCard: async () => ({ question: "Card question" }),
      respondCard: async () => ({
        type: "question",
        question: "Card question",
      }),
      getCardSession: () => undefined,
      ...overrides,
    };
    const boardStore = createBoardStore(() => {});
    const server = Fastify();
    servers.push(server);
    registerDeviseRoutes(server, { engine, boardStore, projectStore });
    return { server, boardStore, project };
  }

  function requirementsUpdatedSession() {
    return {
      projectId: "project-1",
      cardId: "card-1",
      status: "complete" as const,
      messages: [
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              function: { name: "update_requirements", arguments: "{}" },
            },
          ],
        },
      ],
    };
  }
});
