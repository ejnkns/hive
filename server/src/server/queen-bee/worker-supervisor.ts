/** @public */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { WorkAttempt, WorkerHandover } from "shared/board-types";
import type { Message } from "shared/message";
import type { BoardStore, Card } from "./board-store";
import type { Coordinator } from "./coordinator";
import {
  createDeviseModelCaller,
  type DeviseModelCaller,
} from "./devise-engine/create-devise-model-caller";
import type {
  NewCardActivityEvent,
  QueenBeeRuntimeStore,
} from "./queen-bee-runtime-store";
import { readRequirements, requirementsRevision } from "./requirements-store";
import { buildReviewPackage } from "./review-package";
import type { Reviewer } from "./reviewer";
import { buildWorkerContext } from "./worker-supervisor/build-worker-context";
import {
  evaluateCompletion,
  type WorkerCompletion,
  type WorkerToolEvidence,
} from "./worker-supervisor/completion-gate";
import { prepareWorktree } from "./worker-supervisor/git-operations";
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
  isRunning(projectId: string, cardId: string): boolean;
  runningCardIds(projectId: string): string[];
  cancel(projectId: string, cardId: string): boolean;
};

export function createWorkerSupervisor(
  boardStore: BoardStore,
  reviewer: Reviewer,
  coordinator: Coordinator,
  runtimeStore: QueenBeeRuntimeStore,
  modelCaller: DeviseModelCaller = createDeviseModelCaller(WORKER_TOOLS)
): WorkerSupervisor {
  const abortControllers = new Map<
    string,
    {
      projectId: string;
      cardId: string;
      phase: "worker" | "reviewer";
      controller: AbortController;
    }
  >();

  return {
    async run(
      projectId,
      card,
      repoPath,
      systemPrompt,
      codingGuidelines,
      onEvent
    ) {
      const attemptKey = runningAttemptKey(projectId, card.id);
      if (abortControllers.has(attemptKey)) {
        throw new Error(
          `Worker Agent is already running for card '${card.id}'`
        );
      }
      const controller = new AbortController();
      abortControllers.set(attemptKey, {
        projectId,
        cardId: card.id,
        phase: "worker",
        controller,
      });

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
        abortControllers.delete(attemptKey);
      }
    },

    isRunning(projectId: string, cardId: string) {
      return (
        abortControllers.get(runningAttemptKey(projectId, cardId))?.phase ===
        "worker"
      );
    },

    runningCardIds(projectId: string) {
      return [...abortControllers.values()]
        .filter(
          (attempt) =>
            attempt.projectId === projectId && attempt.phase === "worker"
        )
        .map((attempt) => attempt.cardId);
    },

    cancel(projectId: string, cardId: string) {
      const attempt = abortControllers.get(
        runningAttemptKey(projectId, cardId)
      );
      if (attempt?.phase === "worker") {
        attempt.controller.abort();
        return true;
      }
      return false;
    },
  };

  async function runWithController(
    projectId: string,
    card: Card,
    repoPath: string,
    systemPrompt: string,
    codingGuidelines: string,
    onEvent: (event: WorkerEvent) => void,
    controller: AbortController
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

    const attemptNumber = nextAttemptNumber(card);
    const wtResult = prepareWorktree(repoPath, card.id, attemptNumber);
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
    function recordActivity(event: NewCardActivityEvent): void {
      runtimeStore.appendActivity(projectId, card.id, event);
    }
    let workAttempts = beginAttempt(
      card,
      wtResult.branchName,
      worktreePath,
      wtResult.baseCommit,
      attemptNumber,
      startedAt
    );
    onEvent({ type: "worker_started", cardId: card.id });
    recordActivity({
      actor: "supervisor",
      type: "status",
      summary: `Worker Supervisor prepared attempt ${String(attemptNumber)}`,
      detail: `${wtResult.branchName} at ${worktreePath}`,
    });
    boardStore.updateCard(projectId, repoPath, card.id, {
      column: "in_progress",
      workAttempts,
    });
    function persistLog(): void {
      writeWorkerLog(boardStore, projectId, repoPath, card.id, log);
    }
    persistLog();

    const baseCommit = wtResult.baseCommit;
    const messages = buildWorkerContext(card, systemPrompt, codingGuidelines);

    const validation = validateCard(card, worktreePath);
    if (validation !== null) {
      workAttempts = updateCurrentAttempt(workAttempts, {
        status: "worker_error",
      });
      log.error = validation.problem;
      log.finishedAt = new Date().toISOString();
      boardStore.updateCard(projectId, repoPath, card.id, {
        workerLog: log,
        workAttempts,
      });
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
      const result = await runLoop(
        messages,
        worktreePath,
        baseCommit,
        card.id,
        onEvent,
        modelCaller,
        log,
        persistLog,
        recordActivity,
        controller.signal
      );

      if (result.type === "handover") {
        log.error = result.handover.problem;
        log.finishedAt = new Date().toISOString();
        writeWorkerLog(boardStore, projectId, repoPath, card.id, log);
        await handleHandover(
          boardStore,
          coordinator,
          projectId,
          repoPath,
          card,
          result.handover,
          onEvent
        );
        return;
      }

      log.finishedAt = new Date().toISOString();
      writeWorkerLog(boardStore, projectId, repoPath, card.id, log);
      onEvent({
        type: "worker_complete",
        cardId: card.id,
        content: completionDescription(result.completion),
      });
      recordActivity({
        actor: "supervisor",
        type: "status",
        summary: "Completion Gate accepted the Worker Agent submission",
        detail: completionDescription(result.completion),
      });
      boardStore.moveCard(projectId, repoPath, card.id, "reviewing");
      const activeAttempt = abortControllers.get(
        runningAttemptKey(projectId, card.id)
      );
      if (activeAttempt) activeAttempt.phase = "reviewer";

      await runReviewer(
        card,
        repoPath,
        worktreePath,
        projectId,
        boardStore,
        reviewer,
        onEvent,
        baseCommit,
        result.completion,
        workAttempts,
        runtimeStore
      );
    } catch (err) {
      workAttempts = updateCurrentAttempt(workAttempts, {
        status: "worker_error",
      });
      log.error = err instanceof Error ? err.message : "Worker failed";
      log.finishedAt = new Date().toISOString();
      boardStore.updateCard(projectId, repoPath, card.id, {
        workerLog: log,
        workAttempts,
        column: "ready",
      });
      onEvent({
        type: "worker_error",
        cardId: card.id,
        error: log.error,
      });
      recordActivity({
        actor: "supervisor",
        type: "error",
        summary: "Worker Agent attempt failed",
        detail: log.error,
      });
    }
  }
}

function runningAttemptKey(projectId: string, cardId: string): string {
  return `${projectId}\u0000${cardId}`;
}

type WorkerLoopResult =
  | { type: "complete"; completion: WorkerCompletion }
  | { type: "handover"; handover: WorkerHandover };

async function runLoop(
  messages: Message[],
  worktreePath: string,
  baseCommit: string,
  cardId: string,
  onEvent: (event: WorkerEvent) => void,
  modelCaller: ReturnType<typeof createDeviseModelCaller>,
  log: NonNullable<Card["workerLog"]>,
  persistLog: () => void,
  recordActivity: (event: NewCardActivityEvent) => void,
  signal: AbortSignal,
  maxIterations = 20
): Promise<WorkerLoopResult> {
  const evidence = new Map<string, WorkerToolEvidence>();
  let rejectedCompletions = 0;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    signal.throwIfAborted();
    log.iterations = iteration + 1;
    persistLog();

    const response = await modelCaller.call(
      messages,
      worktreePath,
      true,
      signal
    );
    signal.throwIfAborted();

    if (response.content) {
      log.content += `${response.content}\n`;
      persistLog();
      onEvent({
        type: "worker_content",
        cardId,
        content: response.content,
      });
      recordActivity({
        actor: "worker",
        type: "progress",
        summary: summarizeProgress(response.content),
        detail: response.content,
      });
    }

    if (response.toolCalls.length === 0) {
      const parsed = parseWorkerHandover(response.content);
      if (parsed) {
        return {
          type: "handover",
          handover: { ...parsed, occurredAt: new Date().toISOString() },
        };
      }
      rejectedCompletions += 1;
      const correction =
        "Completion rejected: successful work must finish by calling submit_work as the only tool call. Commit coherent changes with commit_work first.";
      if (rejectedCompletions >= 3) {
        return completionGateHandover(correction);
      }
      messages.push({ role: "system", content: correction });
      continue;
    }

    const submission = response.toolCalls.find(
      (toolCall) => toolCall.name === "submit_work"
    );
    if (submission) {
      const gate =
        response.toolCalls.length === 1
          ? evaluateCompletion(submission, worktreePath, baseCommit, evidence)
          : {
              ok: false as const,
              correction:
                "Completion rejected: submit_work must be the only tool call in the response.",
            };
      if (gate.ok) {
        return { type: "complete", completion: gate.completion };
      }
      rejectedCompletions += 1;
      if (rejectedCompletions >= 3) {
        return completionGateHandover(gate.correction);
      }
      appendToolExchange(messages, response, submission, gate.correction);
      onEvent({
        type: "worker_tool",
        cardId,
        toolName: submission.name,
        error: gate.correction,
      });
      continue;
    }

    for (const toolCall of response.toolCalls) {
      log.toolCalls.push({
        name: toolCall.name,
        args: toolCall.arguments.slice(0, 200),
      });
      persistLog();

      const result = await executeWorkerTool(toolCall, worktreePath, signal);
      signal.throwIfAborted();
      evidence.set(toolCall.id, {
        name: toolCall.name,
        arguments: toolCall.arguments,
        output: result.content,
        isError: result.isError,
        headCommit: currentHead(worktreePath),
      });
      appendToolExchange(messages, response, toolCall, result.content);

      onEvent({
        type: "worker_tool",
        cardId,
        toolName: toolCall.name,
      });
      recordActivity({
        actor: "worker",
        type: result.isError ? "error" : "tool",
        summary: `Worker Agent used ${toolCall.name}`,
        detail: result.content,
      });
    }
  }

  throw new Error("Reached maximum iterations");
}

function appendToolExchange(
  messages: Message[],
  response: Awaited<ReturnType<DeviseModelCaller["call"]>>,
  toolCall: { id: string; name: string; arguments: string },
  content: string
): void {
  const assistantMessage: Message = {
    role: "assistant",
    content: response.content,
    tool_calls: [
      {
        id: toolCall.id,
        type: "function",
        function: { name: toolCall.name, arguments: toolCall.arguments },
      },
    ],
  };
  if (response.reasoningContent) {
    assistantMessage.reasoning_content = response.reasoningContent;
  }
  if (response.reasoning) assistantMessage.reasoning = response.reasoning;
  messages.push(assistantMessage, {
    role: "tool",
    content,
    tool_call_id: toolCall.id,
  });
}

function currentHead(worktreePath: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: worktreePath,
    encoding: "utf-8",
    timeout: 5_000,
  }).trim();
}

function completionGateHandover(correction: string): WorkerLoopResult {
  return {
    type: "handover",
    handover: {
      problem: "Completion Gate rejected the Worker Agent three times.",
      attempted: [
        "Reprompted the Worker Agent with deterministic corrections.",
      ],
      blockedBy: [correction],
      occurredAt: new Date().toISOString(),
    },
  };
}

function completionDescription(completion: WorkerCompletion): string {
  return completion.outcome === "implemented"
    ? "Committed work submitted for review"
    : "No-change claim submitted for review";
}

function summarizeProgress(content: string): string {
  const firstLine = content
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return "Worker Agent reported progress";
  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}...` : firstLine;
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
  baseCommit: string,
  completion: WorkerCompletion,
  workAttempts: WorkAttempt[],
  runtimeStore: QueenBeeRuntimeStore
): Promise<void> {
  let reviewPackage: ReturnType<typeof buildReviewPackage> | null = null;
  try {
    reviewPackage = buildReviewPackage(
      card,
      repoPath,
      worktreePath,
      baseCommit,
      completion
    );
    runtimeStore.saveReviewPackage(projectId, reviewPackage);
    runtimeStore.appendActivity(projectId, card.id, {
      actor: "reviewer",
      type: "status",
      summary: "Reviewer Agent started an immutable Review Package",
      detail: reviewPackage.id,
    });
    const verdict = await reviewer.review(reviewPackage, worktreePath);

    const reviewerLog = {
      status: "complete" as const,
      verdict: verdict.verdict,
      findings: verdict.findings,
      verificationAssessment: verdict.verificationAssessment,
      reviewPackageId: reviewPackage.id,
      reviewedAt: new Date().toISOString(),
    };
    const reviewedAttempts = updateCurrentAttempt(workAttempts, {
      status: "reviewed",
      reviewedHead: reviewPackage.revisions.headCommit,
      reviewedIntegrationRevision: reviewPackage.revisions.integrationCommit,
      reviewPackageId: reviewPackage.id,
    });

    boardStore.updateCard(projectId, repoPath, card.id, {
      reviewerLog,
      workAttempts: reviewedAttempts,
      column: "reviewing",
    });
    onEvent({
      type: "worker_content",
      cardId: card.id,
      content:
        verdict.verdict === "approved"
          ? "Reviewer Agent approved the immutable Review Package. Awaiting user acceptance."
          : `Reviewer Agent requested changes with ${String(verdict.findings.length)} finding(s). Awaiting user decision.`,
    });
    runtimeStore.appendActivity(projectId, card.id, {
      actor: "reviewer",
      type: "decision",
      summary:
        verdict.verdict === "approved"
          ? "Reviewer Agent approved the Review Package"
          : "Reviewer Agent requested changes",
      detail: JSON.stringify(verdict),
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown reviewer error";
    boardStore.updateCard(projectId, repoPath, card.id, {
      reviewerLog: {
        status: "error",
        error,
        reviewedAt: new Date().toISOString(),
      },
      workAttempts: updateCurrentAttempt(workAttempts, {
        status: "review_error",
        ...(reviewPackage
          ? {
              reviewedHead: reviewPackage.revisions.headCommit,
              reviewedIntegrationRevision:
                reviewPackage.revisions.integrationCommit,
              reviewPackageId: reviewPackage.id,
            }
          : {}),
      }),
      column: "reviewing",
    });
    onEvent({
      type: "worker_error",
      cardId: card.id,
      error: `Reviewer Agent failed: ${error}`,
    });
    runtimeStore.appendActivity(projectId, card.id, {
      actor: "reviewer",
      type: "error",
      summary: "Reviewer Agent failed to submit a valid review",
      detail: error,
    });
  }
}

function nextAttemptNumber(card: Card): number {
  const currentAttempt = card.workAttempts?.at(-1);
  if (card.column === "in_progress" && currentAttempt?.status === "working") {
    return currentAttempt.attempt;
  }
  return (currentAttempt?.attempt ?? 0) + 1;
}

function beginAttempt(
  card: Card,
  branchName: string,
  worktreePath: string,
  baseCommit: string,
  attempt: number,
  startedAt: string
): WorkAttempt[] {
  const previous = card.workAttempts ?? [];
  const current = previous.at(-1);
  if (
    current?.attempt === attempt &&
    current.branchName === branchName &&
    current.status === "working"
  ) {
    return previous;
  }
  return [
    ...previous,
    {
      attempt,
      branchName,
      worktreePath,
      baseCommit,
      status: "working",
      startedAt,
    },
  ];
}

function updateCurrentAttempt(
  workAttempts: WorkAttempt[],
  patch: Partial<WorkAttempt>
): WorkAttempt[] {
  return workAttempts.map((attempt, index) =>
    index === workAttempts.length - 1 ? { ...attempt, ...patch } : attempt
  );
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
