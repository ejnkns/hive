import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import type { ProjectListItem } from "shared/project-types";
import { createBoardStore } from "./board-store";
import { registerCoordinatorRoutes } from "./coordinator-routes";
import type { ProjectStore } from "./create-project-store";
import type { DeviseEngine } from "./devise-engine";

describe("coordinator routes", () => {
  const directories: string[] = [];
  const servers: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("starts a card-scoped devise session for redevise remediation", async () => {
    const repoPath = mkdtempSync(join(tmpdir(), "hive-coordinator-routes-"));
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
    const card = boardStore.addCard(project.id, project.repoPath, {
      title: "Resolve requirements conflict",
      description: "The worker found ambiguous scope",
      acceptanceCriteria: ["The scope is confirmed"],
      relevantFiles: ["src/feature.ts"],
      dependencies: [],
      column: "unfulfillable",
      coordinatorLog: {
        status: "complete",
        suggestions: [
          {
            id: "suggestion-1",
            action: "redevise",
            rationale: "Ask the user which behavior should win",
          },
        ],
      },
    });
    let startCardArgs: unknown[] | undefined;
    const engine: DeviseEngine = {
      start: async () => ({ question: "Question" }),
      respond: async () => ({ type: "question", question: "Question" }),
      getSession: () => undefined,
      async startCard(...args) {
        startCardArgs = args;
        return { question: "Which behavior should win?" };
      },
      respondCard: async () => ({
        type: "question",
        question: "Card question",
      }),
      getCardSession: () => undefined,
    };
    const server = Fastify();
    servers.push(server);
    registerCoordinatorRoutes(server, { boardStore, projectStore, engine });

    const response = await server.inject({
      method: "POST",
      url: `/api/queen-bee/${project.id}/cards/${card.id}/remediate`,
      payload: { action: "redevise", suggestionId: "suggestion-1" },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().redevise, true);
    assert.equal(response.json().question, "Which behavior should win?");
    assert.equal(response.json().card.column, "idea");
    assert.equal(startCardArgs?.[0], project.id);
    assert.equal(startCardArgs?.[1], card.id);
    assert.match(String(startCardArgs?.[2]), /which behavior should win/i);
  });
});
