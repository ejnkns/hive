/** @public */

import type { Message } from "shared/message";
import type { BoardStore, Card } from "./board-store";
import { createDeviseModelCaller } from "./devise-engine/create-devise-model-caller";
import { buildWorkerContext } from "./worker-supervisor/build-worker-context";
import {
  commitChanges,
  createBranch,
  createWorktree,
  getWorktreePath,
  removeWorktree,
} from "./worker-supervisor/git-operations";
import {
  executeWorkerTool,
  WORKER_TOOLS,
} from "./worker-supervisor/worker-tools";

export type WorkerEvent = {
  type:
    | "worker_started"
    | "worker_content"
    | "worker_tool"
    | "worker_complete"
    | "worker_error";
  cardId: string;
  content?: string;
  toolName?: string;
  error?: string;
};

export type WorkerSupervisor = {
  run(
    card: Card,
    repoPath: string,
    systemPrompt: string,
    codingGuidelines: string,
    onEvent: (event: WorkerEvent) => void
  ): Promise<void>;
};

export function createWorkerSupervisor(
  boardStore: BoardStore
): WorkerSupervisor {
  const modelCaller = createDeviseModelCaller(WORKER_TOOLS);

  return {
    async run(card, repoPath, systemPrompt, codingGuidelines, onEvent) {
      const projectId = boardStore.getBoard("", repoPath).projectId;
      const startedAt = new Date().toISOString();
      const log: NonNullable<Card["workerLog"]> = {
        startedAt,
        finishedAt: "",
        iterations: 0,
        toolCalls: [],
        error: undefined,
        content: "",
      };

      const worktreePath = getWorktreePath(repoPath, card.id);

      removeWorktree(repoPath, card.id);

      const wtResult = createWorktree(repoPath, card.id);
      if (!wtResult.ok) {
        log.error = wtResult.message;
        log.finishedAt = new Date().toISOString();
        writeWorkerLog(boardStore, repoPath, card, log);
        boardStore.moveCard(projectId, repoPath, card.id, "ready");
        onEvent({
          type: "worker_error",
          cardId: card.id,
          error: wtResult.message,
        });
        return;
      }

      const branchName = `qb/${card.id}`;
      const brResult = createBranch(worktreePath, branchName);
      if (!brResult.ok) {
        log.error = brResult.message;
        log.finishedAt = new Date().toISOString();
        writeWorkerLog(boardStore, repoPath, card, log);
        boardStore.moveCard(projectId, repoPath, card.id, "ready");
        onEvent({
          type: "worker_error",
          cardId: card.id,
          error: brResult.message,
        });
        return;
      }

      onEvent({ type: "worker_started", cardId: card.id });
      boardStore.moveCard(projectId, repoPath, card.id, "in_progress");

      const messages = buildWorkerContext(card, systemPrompt, codingGuidelines);

      try {
        await runLoop(
          messages,
          worktreePath,
          card.id,
          onEvent,
          modelCaller,
          log
        );

        const commitResult = commitChanges(worktreePath, `feat: ${card.title}`);

        log.finishedAt = new Date().toISOString();
        writeWorkerLog(boardStore, repoPath, card, log);

        if (commitResult.ok) {
          onEvent({
            type: "worker_complete",
            cardId: card.id,
            content: commitResult.message,
          });
          boardStore.moveCard(projectId, repoPath, card.id, "reviewing");
        } else {
          onEvent({
            type: "worker_error",
            cardId: card.id,
            error: commitResult.message,
          });
          boardStore.moveCard(projectId, repoPath, card.id, "ready");
        }
      } catch (err) {
        log.error = err instanceof Error ? err.message : "Worker failed";
        log.finishedAt = new Date().toISOString();
        writeWorkerLog(boardStore, repoPath, card, log);
        boardStore.moveCard(projectId, repoPath, card.id, "ready");
        onEvent({
          type: "worker_error",
          cardId: card.id,
          error: log.error,
        });
      }
    },
  };
}

async function runLoop(
  messages: Message[],
  worktreePath: string,
  cardId: string,
  onEvent: (event: WorkerEvent) => void,
  modelCaller: ReturnType<typeof createDeviseModelCaller>,
  log: NonNullable<Card["workerLog"]>,
  maxIterations = 20
): Promise<void> {
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    log.iterations = iteration + 1;

    const response = await modelCaller.call(messages, worktreePath, true);

    if (response.content) {
      log.content += `${response.content}\n`;
      onEvent({
        type: "worker_content",
        cardId,
        content: response.content,
      });
    }

    if (response.toolCalls.length === 0) {
      return;
    }

    for (const toolCall of response.toolCalls) {
      log.toolCalls.push({
        name: toolCall.name,
        args: toolCall.arguments.slice(0, 200),
      });

      const result = executeWorkerTool(toolCall, worktreePath);

      messages.push({
        role: "assistant",
        content: response.content,
        tool_calls: [
          {
            id: toolCall.id,
            type: "function",
            function: {
              name: toolCall.name,
              arguments: toolCall.arguments,
            },
          },
        ],
      });

      messages.push({
        role: "tool",
        content: result.content,
        tool_call_id: toolCall.id,
      });

      onEvent({
        type: "worker_tool",
        cardId,
        toolName: toolCall.name,
      });
    }
  }

  throw new Error("Reached maximum iterations");
}

function writeWorkerLog(
  boardStore: BoardStore,
  repoPath: string,
  card: Card,
  log: NonNullable<Card["workerLog"]>
): void {
  try {
    const board = boardStore.getBoard(card.id, repoPath);
    const existing = board.cards.find((c) => c.id === card.id);
    if (existing) {
      existing.workerLog = log;
      boardStore.saveCards(card.id, repoPath, board.cards);
    }
  } catch {
    // ignore log write failures
  }
}
