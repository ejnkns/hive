/** @public */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { WorkerHandover } from "shared/board-types";
import type { Message } from "shared/message";
import type { BoardStore, Card } from "./board-store";
import type { Coordinator } from "./coordinator";
import {
  createDeviseModelCaller,
  type DeviseModelCaller,
} from "./devise-engine/create-devise-model-caller";
import { readRequirements, requirementsRevision } from "./requirements-store";
import type { Reviewer } from "./reviewer";
import { buildWorkerContext } from "./worker-supervisor/build-worker-context";
import {
  commitChanges,
  createPullRequest,
  getDiff,
  prepareWorktree,
  removeWorktree,
} from "./worker-supervisor/git-operations";
import { parseWorkerHandover } from "./worker-supervisor/parse-worker-handover";
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
    | "worker_error"
    | "unfulfillable_handover";
  cardId: string;
  content?: string;
  toolName?: string;
  error?: string;
  suggestions?: string[];
};

export type WorkerSupervisor = {
  run(
    projectId: string,
    card: Card,
    repoPath: string,
    systemPrompt: string,
    codingGuidelines: string,
    onEvent: (event: WorkerEvent) => void
  ): Promise<void>;
  cancel(cardId: string): void;
};

export function createWorkerSupervisor(
  boardStore: BoardStore,
  reviewer: Reviewer,
  coordinator: Coordinator,
  modelCaller: DeviseModelCaller = createDeviseModelCaller(WORKER_TOOLS)
): WorkerSupervisor {
  const abortControllers = new Map<string, AbortController>();

  return {
    async run(
      projectId,
      card,
      repoPath,
      systemPrompt,
      codingGuidelines,
      onEvent
    ) {
      const controller = new AbortController();
      abortControllers.set(card.id, controller);

      try {
        await runWithController(
          projectId,
          card,
          repoPath,
          systemPrompt,
          codingGuidelines,
          onEvent,
          controller
        );
      } finally {
        abortControllers.delete(card.id);
      }
    },

    cancel(cardId: string) {
      const controller = abortControllers.get(cardId);
      if (controller) {
        controller.abort();
        abortControllers.delete(cardId);
      }
    },
  };

  async function runWithController(
    projectId: string,
    card: Card,
    repoPath: string,
    systemPrompt: string,
    codingGuidelines: string,
    onEvent: (event: WorkerEvent) => void,
    _controller: AbortController
  ) {
    const startedAt = new Date().toISOString();
    const log: NonNullable<Card["workerLog"]> = {
      startedAt,
      finishedAt: "",
      iterations: 0,
      toolCalls: [],
      error: undefined,
      content: "",
    };

    const wtResult = prepareWorktree(repoPath, card.id);
    if (!wtResult.ok) {
      log.error = wtResult.message;
      log.finishedAt = new Date().toISOString();
      writeWorkerLog(boardStore, projectId, repoPath, card.id, log);
      boardStore.moveCard(projectId, repoPath, card.id, "ready");
      onEvent({
        type: "worker_error",
        cardId: card.id,
        error: wtResult.message,
      });
      return;
    }

    const worktreePath = wtResult.path;
    const branchName = `qb/${card.id}`;

    onEvent({ type: "worker_started", cardId: card.id });
    boardStore.moveCard(projectId, repoPath, card.id, "in_progress");
    const persistLog = () =>
      writeWorkerLog(boardStore, projectId, repoPath, card.id, log);
    persistLog();

    const baseCommit = wtResult.baseCommit;
    const messages = buildWorkerContext(card, systemPrompt, codingGuidelines);

    const validation = validateCard(card, worktreePath);
    if (validation !== null) {
      log.error = validation.problem;
      log.finishedAt = new Date().toISOString();
      writeWorkerLog(boardStore, projectId, repoPath, card.id, log);
      await handleHandover(
        boardStore,
        coordinator,
        projectId,
        repoPath,
        card,
        validation,
        onEvent
      );
      return;
    }

    try {
      const handover = await runLoop(
        messages,
        worktreePath,
        card.id,
        onEvent,
        modelCaller,
        log,
        persistLog
      );

      if (handover) {
        log.error = handover.problem;
        log.finishedAt = new Date().toISOString();
        writeWorkerLog(boardStore, projectId, repoPath, card.id, log);
        await handleHandover(
          boardStore,
          coordinator,
          projectId,
          repoPath,
          card,
          handover,
          onEvent
        );
        return;
      }

      const commitResult = commitChanges(worktreePath, `worker: ${card.title}`);

      log.finishedAt = new Date().toISOString();
      writeWorkerLog(boardStore, projectId, repoPath, card.id, log);

      if (commitResult.ok) {
        const branchSummary = await summarizeBranch(
          modelCaller,
          card,
          worktreePath,
          commitResult.message
        );
        const pr = createPullRequest(
          worktreePath,
          branchName,
          card.title,
          branchSummary
        );
        boardStore.updateCard(projectId, repoPath, card.id, {
          branchSummary,
          prUrl: pr.url,
          prError: pr.ok ? undefined : pr.message,
        });
        onEvent({
          type: "worker_complete",
          cardId: card.id,
          content: commitResult.message,
        });
        boardStore.moveCard(projectId, repoPath, card.id, "reviewing");

        await runReviewer(
          card,
          repoPath,
          worktreePath,
          projectId,
          boardStore,
          reviewer,
          onEvent,
          baseCommit
        );
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
      writeWorkerLog(boardStore, projectId, repoPath, card.id, log);
      boardStore.moveCard(projectId, repoPath, card.id, "ready");
      onEvent({
        type: "worker_error",
        cardId: card.id,
        error: log.error,
      });
    }
  }
}

async function summarizeBranch(
  modelCaller: ReturnType<typeof createDeviseModelCaller>,
  card: Card,
  worktreePath: string,
  fallback: string
): Promise<string> {
  try {
    const response = await modelCaller.call(
      [
        {
          role: "user",
          content: `Summarize what was implemented for "${card.title}" in two or three concise sentences. Do not mention tools.`,
        },
      ],
      worktreePath,
      false
    );
    return response.content.trim() || fallback;
  } catch {
    return fallback;
  }
}

async function runLoop(
  messages: Message[],
  worktreePath: string,
  cardId: string,
  onEvent: (event: WorkerEvent) => void,
  modelCaller: ReturnType<typeof createDeviseModelCaller>,
  log: NonNullable<Card["workerLog"]>,
  persistLog: () => void,
  maxIterations = 20
): Promise<WorkerHandover | null> {
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    log.iterations = iteration + 1;
    persistLog();

    const response = await modelCaller.call(messages, worktreePath, true);

    if (response.content) {
      log.content += `${response.content}\n`;
      persistLog();
      onEvent({
        type: "worker_content",
        cardId,
        content: response.content,
      });
    }

    if (response.toolCalls.length === 0) {
      const parsed = parseWorkerHandover(response.content);
      return parsed
        ? { ...parsed, occurredAt: new Date().toISOString() }
        : null;
    }

    for (const toolCall of response.toolCalls) {
      log.toolCalls.push({
        name: toolCall.name,
        args: toolCall.arguments.slice(0, 200),
      });
      persistLog();

      const result = await executeWorkerTool(toolCall, worktreePath);

      const assistantMsg: Message = {
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
      };

      if (response.reasoningContent) {
        assistantMsg.reasoning_content = response.reasoningContent;
      }

      if (response.reasoning) {
        assistantMsg.reasoning = response.reasoning;
      }

      messages.push(assistantMsg);

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

function validateCard(card: Card, worktreePath: string): WorkerHandover | null {
  if (!card.relevantFiles || card.relevantFiles.length === 0) {
    return {
      problem: `Card "${card.title}" has no relevant files.`,
      attempted: [],
      blockedBy: [
        "The worker has no grounded starting point in the workspace.",
      ],
      occurredAt: new Date().toISOString(),
    };
  }

  const missing: string[] = [];
  for (const file of card.relevantFiles) {
    const filePath = join(worktreePath, file);
    if (!existsSync(filePath)) {
      missing.push(file);
    }
  }

  if (missing.length > 0) {
    return {
      problem: `Validation failed for card "${card.title}": assigned files are missing.`,
      attempted: ["Checked every assigned relevant file in the worktree."],
      blockedBy: missing,
      occurredAt: new Date().toISOString(),
    };
  }

  return null;
}

function writeWorkerLog(
  boardStore: BoardStore,
  projectId: string,
  repoPath: string,
  cardId: string,
  log: NonNullable<Card["workerLog"]>
): void {
  try {
    boardStore.updateCard(projectId, repoPath, cardId, { workerLog: log });
  } catch {
    // ignore log write failures
  }
}

async function runReviewer(
  card: Card,
  repoPath: string,
  worktreePath: string,
  projectId: string,
  boardStore: BoardStore,
  reviewer: Reviewer,
  onEvent: (event: WorkerEvent) => void,
  baseCommit: string
): Promise<void> {
  try {
    const diff = getDiff(worktreePath, baseCommit);
    const verdict = await reviewer.review(card, diff, worktreePath);

    const reviewerLog = {
      verdict: verdict.verdict,
      feedback: verdict.feedback,
      reviewedAt: new Date().toISOString(),
    };

    if (verdict.verdict === "pass") {
      boardStore.updateCard(projectId, repoPath, card.id, {
        reviewerLog,
        column: "done",
      });
      removeWorktree(repoPath, card.id);
      onEvent({
        type: "worker_content",
        cardId: card.id,
        content: `Review passed: ${verdict.feedback}`,
      });
    } else {
      boardStore.updateCard(projectId, repoPath, card.id, {
        reviewerLog,
        column: "in_progress",
      });
      onEvent({
        type: "worker_error",
        cardId: card.id,
        error: `Review failed: ${verdict.feedback}`,
      });
    }
  } catch (err) {
    onEvent({
      type: "worker_error",
      cardId: card.id,
      error: `Reviewer error: ${err instanceof Error ? err.message : "Unknown"}`,
    });
  }
}

async function handleHandover(
  boardStore: BoardStore,
  coordinator: Coordinator,
  projectId: string,
  repoPath: string,
  card: Card,
  handover: WorkerHandover,
  onEvent: (event: WorkerEvent) => void
): Promise<void> {
  const unfulfillable = boardStore.updateCard(projectId, repoPath, card.id, {
    column: "unfulfillable",
    handover,
    coordinatorLog: { status: "pending" },
  });

  try {
    const requirementsContent = readRequirements(repoPath);
    const analysis = await coordinator.analyze(
      unfulfillable,
      requirementsContent
    );
    boardStore.updateCard(projectId, repoPath, card.id, {
      coordinatorLog: {
        status: "complete",
        analyzedAt: new Date().toISOString(),
        requirementsRevision: requirementsRevision(requirementsContent),
        summary: analysis.summary,
        suggestions: analysis.suggestions,
      },
    });
    onEvent({
      type: "unfulfillable_handover",
      cardId: card.id,
      content: analysis.summary,
      suggestions: analysis.suggestions.map(
        (suggestion) => suggestion.rationale
      ),
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Coordinator failed";
    boardStore.updateCard(projectId, repoPath, card.id, {
      coordinatorLog: { status: "error", error },
    });
    onEvent({ type: "unfulfillable_handover", cardId: card.id, error });
  }
}
