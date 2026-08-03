<script lang="ts">
import Badge from "../shared/ui/Badge.svelte";
import Button from "../shared/ui/Button.svelte";
import Card from "../shared/ui/Card.svelte";
import type {
  ChatMessage,
  VisibleAction,
  WorkflowDef,
  WorkflowInstanceEntry,
} from "./workflow-api";

let {
  workflowDef,
  instanceEntry,
  onAction,
  onSendMessage,
  compact = false,
}: {
  workflowDef: WorkflowDef;
  instanceEntry: WorkflowInstanceEntry;
  onAction?: (actionId: string) => void;
  onSendMessage?: (content: string) => Promise<void>;
  compact?: boolean;
} = $props();

let stateDef = $derived(
  workflowDef.states.find((s) => s.id === instanceEntry.state.currentState) ??
    null
);

// The workflow's item hint is a dotted path into the instance's
// workflowInstanceState (e.g. "cardSpec.title"); unresolved, the card falls
// back to the state label.
let itemTitle = $derived(
  workflowDef.item
    ? resolveItemPath(
        workflowDef.item.title,
        instanceEntry.state.workflowInstanceState
      )
    : undefined
);
let itemSubtitle = $derived(
  workflowDef.item?.subtitle
    ? resolveItemPath(
        workflowDef.item.subtitle,
        instanceEntry.state.workflowInstanceState
      )
    : undefined
);

let category = $derived(stateDef?.category ?? "active");
let isTerminal = $derived(
  workflowDef.terminalStates.includes(instanceEntry.state.currentState)
);
let runningCtx = $derived(instanceEntry.state.runningTaskContext);

let chatInput = $state("");
let sending = $state(false);

let taskOutputEntries = $derived(
  Object.entries(instanceEntry.state.taskOutputs)
);

// The workflow's domain data (e.g. the requirements draft) rendered as readable
// key/value pairs. String values are shown inline; structured values as JSON.
let domainDataEntries = $derived.by(() =>
  Object.entries(instanceEntry.state.workflowInstanceState).map(
    ([key, value]) =>
      [
        key,
        typeof value === "string"
          ? value
          : truncate(JSON.stringify(value, null, 2), 2000),
      ] as [string, string]
  )
);

type TaskOutcomeShape = {
  status?: string;
  error?: string;
  output?: unknown;
};

function outcomeStatus(outcome: unknown): string {
  const status = (outcome as TaskOutcomeShape | null)?.status;
  return typeof status === "string" ? status : "unknown";
}

function outcomeError(outcome: unknown): string | null {
  const error = (outcome as TaskOutcomeShape | null)?.error;
  return typeof error === "string" && error !== "" ? error : null;
}

function outcomeCards(outcome: unknown): Array<{
  title: string;
  description?: string;
  acceptanceCriteria?: string[];
}> | null {
  const output = (outcome as TaskOutcomeShape | null)?.output;
  if (!output || typeof output !== "object") return null;
  const cards = (output as Record<string, unknown>).cards;
  if (!Array.isArray(cards)) return null;
  return cards as Array<{
    title: string;
    description?: string;
    acceptanceCriteria?: string[];
  }>;
}

function outcomeSummary(outcome: unknown): string | null {
  const taskOutcome = outcome as TaskOutcomeShape | null;
  if (taskOutcome?.status !== "success") return null;
  const output = taskOutcome.output;
  if (typeof output === "string") return truncate(output, 2000);
  if (output === null || output === undefined) return null;
  if (typeof output !== "object") return String(output);
  const content = (output as Record<string, unknown>).content;
  if (typeof content === "string") return truncate(content, 2000);
  return truncate(JSON.stringify(output, null, 2), 2000);
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

let actionVariantToButton = $derived.by((): Record<string, string> => {
  const map: Record<string, string> = {};
  for (const action of instanceEntry.availableActions) {
    switch (action.variant) {
      case "primary":
        map[action.id] = "mint";
        break;
      case "destructive":
        map[action.id] = "rose";
        break;
      case "secondary":
        map[action.id] = "platinum";
        break;
      default:
        map[action.id] = "platinum";
    }
  }
  return map;
});

let askConfirm = $state<string | null>(null);

function handleAction(action: VisibleAction) {
  if (action.variant === "destructive") {
    askConfirm = action.id;
    return;
  }
  onAction?.(action.id);
}

function confirmDestructive(actionId: string) {
  askConfirm = null;
  onAction?.(actionId);
}

async function handleSend() {
  const text = chatInput.trim();
  if (!text || !onSendMessage || sending) return;
  sending = true;
  chatInput = "";
  try {
    await onSendMessage(text);
  } finally {
    sending = false;
  }
}

let categoryClass = $derived.by(() => {
  if (category === "terminal" || isTerminal) return "terminal";
  if (category === "error") return "error";
  if (category === "initial") return "initial";
  return "active";
});

let categoryLabel = $derived.by(() => {
  if (category === "terminal" || isTerminal) return "Done";
  if (category === "error") return "Blocked";
  if (category === "initial") return "Ready";
  return "";
});

// Resolves a dotted path like "cardSpec.title" against instance state. Used
// by the workflow's item hint to render a derived item title.
function resolveItemPath(
  path: string,
  state: Record<string, unknown>
): string | undefined {
  let value: unknown = state;
  for (const part of path.split(".")) {
    if (value === null || typeof value !== "object") return undefined;
    const record = value as Record<string, unknown>;
    value = record[part];
  }
  return typeof value === "string" ? value : undefined;
}
</script>

<div class="state-card state-card-{categoryClass}" class:compact>
  <Card>
    <div class="card-header">
      <div class="card-title-row">
        <span class="card-title"
          >{itemTitle ?? stateDef?.label ?? instanceEntry.state.currentState}</span
        >
        {#if itemSubtitle}
          <span class="card-subtitle">{itemSubtitle}</span>
        {/if}
        {#if categoryClass !== "active"}
          <Badge
            variant={categoryClass === "terminal" ? "mint" : categoryClass === "error" ? "rose" : "platinum"}
            outline
          >
            {categoryLabel}
          </Badge>
        {/if}
        {#if instanceEntry.state.hasRunningTask}
          <Badge variant="amber" live>Running</Badge>
        {/if}
      </div>
      {#if !compact && stateDef?.description}
        <div class="state-description">{stateDef.description}</div>
      {/if}
    </div>

    {#if !compact}
      <div class="card-body">
        {#if instanceEntry.state.hasRunningTask && runningCtx}
          <div class="task-panel">
            {#if runningCtx.role === "ai-chat"}
              <div class="chat-messages">
                {#each runningCtx.messages as msg}
                  <div class="chat-msg chat-msg-{msg.role}">
                    <span class="msg-label">{msg.role}</span>
                    <span class="msg-text">{msg.content}</span>
                  </div>
                {/each}
              </div>
              {#if onSendMessage}
                <div class="chat-input-row">
                  <input
                    type="text"
                    class="chat-input"
                    bind:value={chatInput}
                    onkeydown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder="Type a message..."
                    disabled={sending}
                  >
                  <Button
                    variant="mint"
                    size="small"
                    disabled={!chatInput.trim() || sending}
                    onclick={handleSend}
                  >
                    Send
                  </Button>
                </div>
              {/if}
            {:else if runningCtx.role === "ai-task"}
              <div class="task-progress">
                <span class="task-label">Agent running...</span>
                {#if runningCtx.messages.length > 0}
                  <div class="task-messages">
                    {#each runningCtx.messages as msg}
                      <div class="chat-msg chat-msg-{msg.role}">
                        <span class="msg-label">{msg.role}</span>
                        <span class="msg-text">{msg.content}</span>
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            {:else}
              <div class="task-operation">
                <span class="task-label">Operation in progress...</span>
              </div>
            {/if}
          </div>
        {:else if !compact && taskOutputEntries.length > 0}
          <div class="task-outputs">
            <span class="outputs-label">Task outputs</span>
            {#each taskOutputEntries as [ taskId, outcome ]}
              {@const cards = outcomeCards(outcome)}
              <div class="output-item">
                <div class="output-head">
                  <span class="output-task-id">{taskId}</span>
                  <span
                    class="output-status output-status-{outcomeStatus(outcome)}"
                    >{outcomeStatus(outcome)}</span
                  >
                </div>
                {#if outcomeError(outcome)}
                  <div class="output-error">{outcomeError(outcome)}</div>
                {/if}
                {#if cards && cards.length > 0}
                  <div class="output-cards">
                    {#each cards as card}
                      <div class="output-card">
                        <div class="output-card-title">{card.title}</div>
                        {#if card.description}
                          <div class="output-card-desc">{card.description}</div>
                        {/if}
                        {#if card.acceptanceCriteria && card.acceptanceCriteria.length > 0}
                          <ul class="output-card-criteria">
                            {#each card.acceptanceCriteria as criterion}
                              <li>{criterion}</li>
                            {/each}
                          </ul>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {:else if outcomeSummary(outcome)}
                  <pre class="output-summary">{outcomeSummary(outcome)}</pre>
                {/if}
              </div>
            {/each}
          </div>
        {/if}

        {#if domainDataEntries.length > 0}
          <div class="domain-data">
            <span class="outputs-label">Session data</span>
            {#each domainDataEntries as [ key, value ]}
              <div class="domain-data-item">
                <span class="domain-data-key">{key}</span>
                <pre class="domain-data-value">{value}</pre>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    {#if instanceEntry.availableActions.length > 0}
      <div class="card-actions">
        {#each instanceEntry.availableActions as action}
          {#if askConfirm === action.id}
            <div class="confirm-row">
              <span class="confirm-text"
                >Confirm {action.label.toLowerCase()}?</span
              >
              <Button
                variant="rose"
                size="small"
                onclick={() => confirmDestructive(action.id)}
                >Confirm</Button
              >
              <Button
                variant="platinum"
                size="small"
                onclick={() => (askConfirm = null)}
                >Cancel</Button
              >
            </div>
          {:else}
            <Button
              variant={actionVariantToButton[action.id] as "mint" | "rose" | "platinum"}
              size="small"
              onclick={() => handleAction(action)}
            >
              {action.label}
            </Button>
          {/if}
        {/each}
      </div>
    {/if}
  </Card>
</div>

<style>
.state-card {
  transition: opacity 0.15s;
}

.state-card.initial {
  opacity: 0.65;
}

.state-card.terminal {
  --card-border: var(--success);
}

.state-card.error {
  --card-border: var(--error);
}

.state-card :global(.card) {
  border-color: var(--card-border, var(--border));
}

.card-header {
  margin-bottom: 0.5rem;
}

.card-title-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.card-title {
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--text);
}

.card-subtitle {
  font-size: 0.625rem;
  color: var(--muted);
}

.state-description {
  font-size: 0.625rem;
  color: var(--muted);
  margin-top: 0.25rem;
}

.card-body {
  margin-bottom: 0.75rem;
}

.task-panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.5rem;
  max-height: 200px;
  overflow-y: auto;
}

.chat-messages {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 0.5rem;
}

.chat-msg {
  display: flex;
  gap: 0.5rem;
  font-size: 0.625rem;
}

.msg-label {
  color: var(--accent);
  font-weight: 700;
  flex-shrink: 0;
  width: 5rem;
  text-transform: uppercase;
  font-size: 0.5625rem;
}

.msg-text {
  color: var(--text);
  word-break: break-word;
}

.chat-input-row {
  display: flex;
  gap: 0.375rem;
}

.chat-input {
  flex: 1;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-family: monospace;
  font-size: 0.625rem;
  padding: 0.25rem 0.5rem;
  outline: none;
}

.chat-input:focus {
  border-color: var(--accent);
}

.task-progress,
.task-operation {
  font-size: 0.625rem;
  color: var(--muted);
}

.task-label {
  display: block;
  margin-bottom: 0.25rem;
}

.task-messages {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.task-outputs {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  font-size: 0.625rem;
}

.outputs-label {
  color: var(--muted);
  font-weight: 600;
  margin-bottom: 0.125rem;
}

.output-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.25rem 0;
  border-top: 1px solid var(--border);
}

.output-item:first-child {
  border-top: none;
}

.output-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.output-task-id {
  color: var(--accent);
  font-family: monospace;
}

.output-status {
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
}

.output-status-success {
  color: var(--success);
}

.output-status-error {
  color: var(--error);
}

.output-error {
  color: var(--error);
  white-space: pre-wrap;
}

.output-summary {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text);
  font-family: var(--font-mono, monospace);
}

.output-cards {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.output-card {
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.375rem 0.5rem;
  background: var(--bg);
}

.output-card-title {
  font-weight: 700;
  color: var(--text);
}

.output-card-desc {
  color: var(--muted);
  margin-top: 0.125rem;
}

.output-card-criteria {
  margin: 0.25rem 0 0 0;
  padding-left: 1rem;
  color: var(--muted);
}

.domain-data {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-top: 0.5rem;
  font-size: 0.625rem;
}

.domain-data-item {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  padding: 0.25rem 0;
  border-top: 1px solid var(--border);
}

.domain-data-item:first-child {
  border-top: none;
}

.domain-data-key {
  color: var(--accent);
  font-family: monospace;
  font-weight: 600;
}

.domain-data-value {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text);
  font-family: var(--font-mono, monospace);
}

.card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

.confirm-row {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  width: 100%;
  padding: 0.25rem;
  background: rgba(220, 60, 60, 0.08);
  border: 1px solid rgba(220, 60, 60, 0.2);
  border-radius: 4px;
}

.confirm-text {
  font-size: 0.625rem;
  color: var(--error);
  font-weight: 600;
  margin-right: auto;
}
</style>
