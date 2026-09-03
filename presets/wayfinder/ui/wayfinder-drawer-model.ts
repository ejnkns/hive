/** The wayfinder drawer view model (module-set sibling of the served flow
 * component): the pure derivation of a selected WorkflowItem's in-context
 * detail — title, derived presentation status, the actual workflow state with
 * its definition label, type, question/brief, blocker and dependent
 * references, the resolution task output, the persisted decision record, the
 * recorded map on the charting anchors (standing notes plus the persisted
 * map.md document), branch/worktree data, the available actions, and the live
 * interactive chat context. A named export a test can import directly as
 * TypeScript, and a value-imported sibling of the served drawer (the server
 * serves the module-set file tree to the browser). Pure so the content
 * decision — what the drawer shows for a frontier ticket vs a research run vs
 * a build item — is testable without DOM.
 *
 * The derivation never reads DOM state and owns no animation state. The node
 * identity is the WorkflowItem id (or the synthetic base/summit ids) from the
 * shared map model; the entry is resolved by the node's instance id, so a
 * node whose WorkflowItem vanished from the snapshot still renders its
 * node-level detail (the drawer degrades instead of breaking). Blocker and
 * dependent references stay raw ids when no node carries them. Resolution
 * content comes only from the task outputs already on the WorkflowItem
 * snapshot; the decision record comes only from the persisted decisions
 * directory; the map document comes only from the declared persisted-output
 * whitelist. */

import type {
  WorkflowDefResponse,
  WorkflowInstanceEntry,
} from "workflow-engine/create-flow-runtime";
import type { RuntimeWorkflowInstanceState } from "workflow-engine/shared/workflow-instance-state";
import type {
  ChatMessage,
  FlowViewProps,
  ModelCallStatus,
  VisibleAction,
} from "workflow-engine/workflow-types";
import type {
  WayfinderMap,
  WayfinderNode,
  WayfinderPresentationStatus,
} from "./wayfinder-map.ts";
import {
  agentIsThinking,
  CHAT_RESOLUTION_TASKS,
  RESEARCH_TASK,
  readDecisionRecord,
  readOutcomeError,
  TICKET_RESOLUTION_TASKS,
} from "./wayfinder-status.ts";

/** A blocker or dependent reference the drawer renders as a navigable chip:
 * the target node's title when the id is a map node, the raw id otherwise
 * (a dangling `dependsOn` reference). */
export type DrawerRef = { id: string; title: string };

/** One reviewer finding off the build-item review task output. */
export type DrawerReviewFinding = {
  axis: string;
  severity: string;
  detail: string;
  evidence: string;
};

/** One planner ticket off the build plan task output. */
export type DrawerPlanTicket = {
  title: string;
  description: string;
  acceptanceCriteria: readonly string[];
  dependsOn: readonly string[];
};

/** The resolution task output the drawer surfaces, per workflow shape:
 * research findings (ai-task), a chat resolution decision, a build worker
 * outcome, the reviewer verdict + findings, or the build plan tickets. */
export type DrawerResolution =
  | { kind: "research"; findings: string; sources: readonly string[] }
  | {
      kind: "decision";
      gist: string;
      decision: string;
      artifactPath?: string;
    }
  | { kind: "build-outcome"; outcome: string; summary: string }
  | {
      kind: "review";
      verdict: string;
      findings: readonly DrawerReviewFinding[];
    }
  | { kind: "plan"; tickets: readonly DrawerPlanTicket[] };

/** The live interactive ai-chat session the drawer embeds (the same context
 * the table cards render through the default chat-session element). */
export type DrawerChat = {
  messages: readonly ChatMessage[];
  sessionId: string;
  interactive: boolean;
  thinking: boolean;
  modelStatus?: ModelCallStatus;
};

/** Everything the in-context detail drawer renders for one selected node. The
 * node-level fields (title, presentation, state fallback, references) always
 * exist; the entry-backed fields (definition label, type, question,
 * resolution, actions, chat) degrade when the WorkflowItem is missing from
 * the snapshot. */
export type DrawerDetail = {
  node: WayfinderNode;
  title: string;
  presentation: WayfinderPresentationStatus;
  presentationLabel: string;
  /** The actual workflow state id from the entry (the node's state as a
   * fallback when the entry is missing). */
  stateId: string;
  /** The definition's state label, or the raw state id when unknown. */
  stateLabel: string;
  type?: string;
  /** The ticket question, or the fog brief. */
  question?: string;
  blockers: readonly DrawerRef[];
  dependents: readonly DrawerRef[];
  /** The resolution task output(s); empty when none has content. */
  resolution: readonly DrawerResolution[];
  /** The first errored resolution task's message, when nothing succeeded. */
  resolutionError?: string;
  /** The persisted decision record (decisions/<id>.md). */
  decisionRecord?: string;
  /** The charting session's standing notes (submit_map's second face).
   * Present only on the charting anchors and only when notes were recorded. */
  notes?: string;
  /** The persisted map document (map.md) — the chart's content. Present
   * (possibly "") only on the charting anchors: "" before settle_chart has
   * persisted one, the document body afterwards. Absent (undefined) on every
   * non-charting WorkflowItem, which renders no map section at all. */
  mapDocument?: string;
  branch?: string;
  worktree?: string;
  actions: readonly VisibleAction[];
  chat?: DrawerChat;
};

/** The drawer view-model seam: selected id + the shared model + the
 * snapshot -> the detail the drawer renders, or undefined when nothing is
 * selected or the id is not a map node. Pure and DOM-free. */
export function deriveDrawerDetail(options: {
  selectedId: string | undefined;
  model: WayfinderMap;
  entries: readonly WorkflowInstanceEntry[];
  workflowDefs: readonly WorkflowDefResponse[];
  persistedOutputDirs:
    | Readonly<Record<string, Readonly<Record<string, string>>>>
    | undefined;
  /** Optional so callers without persisted outputs stay terse; a charting
   * anchor still gets its (empty) map document section. */
  persistedOutputs?: FlowViewProps["persistedOutputs"] | undefined;
}): DrawerDetail | undefined {
  const {
    selectedId,
    model,
    entries,
    workflowDefs,
    persistedOutputDirs,
    persistedOutputs,
  } = options;
  if (selectedId === undefined) return undefined;
  const node = model.nodes.find((candidate) => candidate.id === selectedId);
  if (node === undefined) return undefined;
  const entry = entries.find((candidate) => candidate.id === node.instanceId);
  const instanceState = entry?.state.workflowInstanceState;
  const stateId = entry?.state.currentState ?? node.state;
  const stateDef = workflowDefs
    .find((def) => def.id === node.workflowId)
    ?.states.find((candidate) => candidate.id === stateId);
  const type = readString(instanceState, "type");
  const question = readQuestion(instanceState);
  const resolutionError =
    entry !== undefined ? readResolutionError(entry) : undefined;
  const decisionRecord = readDecisionRecord(persistedOutputDirs, selectedId);
  // The recorded map lives on the charting WorkflowItem (the synthetic
  // base/summit anchors resolve to it): the notes come from the instance
  // state submit_map patches; the map document is the flow's persisted
  // map.md, read through the engine's persisted-output seam. "" means the
  // anchor owns the document but settle_chart has not persisted it yet.
  const isChartingEntry = entry?.workflowId === "charting";
  const notes = readString(instanceState, "notes");
  const branch = readString(instanceState, "branchName");
  const worktree = readString(instanceState, "worktreePath");
  const chat = readChat(entry);
  return {
    node,
    title: node.title,
    presentation: node.presentation,
    presentationLabel: PRESENTATION_LABELS[node.presentation],
    stateId,
    stateLabel: stateDef?.label ?? stateId,
    ...(type !== "" ? { type } : {}),
    ...(question !== undefined ? { question } : {}),
    blockers: referencesOf(model, node.blockers),
    dependents: referencesOf(model, node.dependents),
    resolution: entry === undefined ? [] : readResolution(entry),
    ...(resolutionError !== undefined ? { resolutionError } : {}),
    ...(decisionRecord !== undefined ? { decisionRecord } : {}),
    ...(isChartingEntry
      ? { mapDocument: readMapDocument(persistedOutputs) }
      : {}),
    ...(notes !== "" ? { notes } : {}),
    ...(branch !== "" ? { branch } : {}),
    ...(worktree !== "" ? { worktree } : {}),
    actions: entry?.availableActions ?? [],
    ...(chat !== undefined ? { chat } : {}),
  };
}

// The presentation labels the drawer shows next to the actual state. Colour
// and glyph are accents — the text label carries the meaning.
const PRESENTATION_LABELS: Record<WayfinderPresentationStatus, string> = {
  base: "Base camp",
  fog: "Fog",
  frontier: "Frontier",
  blocked: "Blocked",
  active: "Active",
  decision: "Decision",
  "out-of-scope": "Out of scope",
  implementation: "Implementation",
  summit: "Summit",
};

// The build-outcome task ids per workflow shape. A ticket resolves through
// the research (ai-task) or one of the chat sessions (wayfinder-status.ts);
// a build item through the worker session and the review; a build through
// the planner.
const BUILD_OUTCOME_TASK = "runAgent";
const REVIEW_TASK = "review";
const PLAN_TASK = "plan";

// The ticket's resolution content: research findings first, then whichever
// chat resolution session completed with a decision or gist. Empty when no
// resolution task has content yet.
function readTicketResolution(
  state: RuntimeWorkflowInstanceState
): DrawerResolution[] {
  const research = state.taskOutputs[RESEARCH_TASK];
  const findings = readOutputString(research, "findings");
  if (findings !== "") {
    return [
      {
        kind: "research",
        findings,
        sources: readOutputStrings(research, "sources"),
      },
    ];
  }
  for (const taskId of CHAT_RESOLUTION_TASKS) {
    const outcome = state.taskOutputs[taskId];
    if (outcome === undefined || outcome.status !== "success") continue;
    const decision = readCompletionString(outcome, "decision");
    const gist = readCompletionString(outcome, "gist");
    if (decision === "" && gist === "") continue;
    const artifactPath = readCompletionString(outcome, "artifactPath");
    return [
      {
        kind: "decision",
        gist,
        decision,
        ...(artifactPath !== "" ? { artifactPath } : {}),
      },
    ];
  }
  return [];
}

// The build-item resolution content: the worker's outcome + summary and the
// reviewer's verdict + findings, whichever are present.
function readBuildItemResolution(
  state: RuntimeWorkflowInstanceState
): DrawerResolution[] {
  const resolution: DrawerResolution[] = [];
  const runAgent = state.taskOutputs[BUILD_OUTCOME_TASK];
  const outcome = readCompletionString(runAgent, "outcome");
  if (outcome !== "") {
    resolution.push({
      kind: "build-outcome",
      outcome,
      summary: readCompletionString(runAgent, "summary"),
    });
  }
  const review = state.taskOutputs[REVIEW_TASK];
  const verdict = readOutputString(review, "verdict");
  if (verdict !== "") {
    resolution.push({
      kind: "review",
      verdict,
      findings: readReviewFindings(review),
    });
  }
  return resolution;
}

// The build resolution content: the planner's tracer-bullet tickets.
function readBuildResolution(
  state: RuntimeWorkflowInstanceState
): DrawerResolution[] {
  const plan = state.taskOutputs[PLAN_TASK];
  const tickets = readOutputObjects(plan, "tickets");
  if (tickets.length === 0) return [];
  return [
    {
      kind: "plan",
      tickets: tickets.map((ticketValue) => ({
        title: readString(ticketValue, "title"),
        description: readString(ticketValue, "description"),
        acceptanceCriteria: readStrings(ticketValue, "acceptanceCriteria"),
        dependsOn: readStrings(ticketValue, "dependsOn"),
      })),
    },
  ];
}

function readResolution(entry: WorkflowInstanceEntry): DrawerResolution[] {
  switch (entry.workflowId) {
    case "ticket":
      return readTicketResolution(entry.state);
    case "buildItem":
      return readBuildItemResolution(entry.state);
    case "build":
      return readBuildResolution(entry.state);
    default:
      return [];
  }
}

// The first errored resolution task's message, when no resolution succeeded —
// the drawer names the reason the run stopped (the retry action sits below).
function readResolutionError(entry: WorkflowInstanceEntry): string | undefined {
  if (entry.workflowId !== "ticket") return undefined;
  for (const taskId of TICKET_RESOLUTION_TASKS) {
    const outcome = entry.state.taskOutputs[taskId];
    if (outcome !== undefined && outcome.status === "error") {
      return readOutcomeError(outcome);
    }
  }
  return undefined;
}

// The reviewer findings array, read defensively into stable string fields
// (absent values read as "" so the renderer can decide).
function readReviewFindings(outcome: unknown): DrawerReviewFinding[] {
  return readOutputObjects(outcome, "findings").map((finding) => ({
    axis: readString(finding, "axis"),
    severity: readString(finding, "severity"),
    detail: readString(finding, "detail"),
    evidence: readString(finding, "evidence"),
  }));
}

// Resolves a blocker/dependent id list to its display references: the map
// node title when the id is a node, the raw id otherwise.
function referencesOf(
  model: WayfinderMap,
  ids: readonly string[]
): DrawerRef[] {
  return ids.map((id) => {
    const node = model.nodes.find((candidate) => candidate.id === id);
    return node === undefined ? { id, title: id } : { id, title: node.title };
  });
}

// The persisted map document off the declared persisted-output whitelist.
// A missing or empty document reads as "" — the anchor owns the document
// regardless; the renderer decides content vs empty state.
function readMapDocument(
  persistedOutputs: Readonly<Record<string, string>> | undefined
): string {
  return persistedOutputs?.["map.md"] ?? "";
}

// The ticket question, or the fog brief. Neither present -> undefined.
function readQuestion(instanceState: unknown): string | undefined {
  const question = readString(instanceState, "question");
  if (question !== "") return question;
  const brief = readString(instanceState, "brief");
  return brief !== "" ? brief : undefined;
}

// The live interactive ai-chat session, when one runs; one-shot (read-only)
// sessions are not surfaced as chat.
function readChat(
  entry: WorkflowInstanceEntry | undefined
): DrawerChat | undefined {
  if (entry === undefined) return undefined;
  const ctx = entry.state.runningTaskContext;
  if (!entry.state.hasRunningTask || ctx === null) return undefined;
  if (ctx.role !== "ai-chat" || ctx.interactive !== true) return undefined;
  return {
    messages: ctx.messages,
    sessionId: ctx.sessionId,
    interactive: true,
    thinking: agentIsThinking(ctx.messages),
    ...(ctx.modelStatus !== undefined ? { modelStatus: ctx.modelStatus } : {}),
  };
}

// Defensive readers over the open wire shapes: absent or non-string values
// read as "" (or []), never throwing on a foreign shape.
function readString(item: unknown, field: string): string {
  if (item === null || typeof item !== "object") return "";
  const value = (item as Record<string, unknown>)[field];
  return typeof value === "string" ? value : "";
}

function readStrings(item: unknown, field: string): string[] {
  if (item === null || typeof item !== "object") return [];
  const value = (item as Record<string, unknown>)[field];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

// The output block of a task outcome (the ai-task args live under
// output.<field>).
function readOutput(outcome: unknown): Record<string, unknown> | undefined {
  if (outcome === null || typeof outcome !== "object") return undefined;
  const output = (outcome as Record<string, unknown>).output;
  if (output === null || typeof output !== "object") return undefined;
  return output as Record<string, unknown>;
}

function readOutputString(outcome: unknown, field: string): string {
  return readString(readOutput(outcome), field);
}

function readOutputStrings(outcome: unknown, field: string): string[] {
  return readStrings(readOutput(outcome), field);
}

function readOutputObjects(outcome: unknown, field: string): unknown[] {
  const output = readOutput(outcome);
  if (output === undefined) return [];
  const value = output[field];
  return Array.isArray(value) ? value : [];
}

// The completion block of an ai-chat task outcome (the completion args live
// under output.completion.<field>).
function readCompletion(outcome: unknown): Record<string, unknown> | undefined {
  const output = readOutput(outcome);
  if (output === undefined) return undefined;
  const completion = output.completion;
  if (completion === null || typeof completion !== "object") return undefined;
  return completion as Record<string, unknown>;
}

function readCompletionString(outcome: unknown, field: string): string {
  return readString(readCompletion(outcome), field);
}
