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
        {:else if !compact && instanceEntry.state.taskOutputs && Object.keys(instanceEntry.state.taskOutputs).length > 0}
          <div class="task-outputs">
            <span class="outputs-label">Task outputs</span>
            {#each Object.entries(instanceEntry.state.taskOutputs) as [ taskId, outcome ]}
              <div class="output-item">
                <span class="output-task-id">{taskId}</span>
                <span class="output-status"
                  >{(outcome as Record<string, unknown>)?.status as string ?? "unknown"}</span
                >
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
  gap: 0.5rem;
}

.output-task-id {
  color: var(--accent);
  font-family: monospace;
}

.output-status {
  color: var(--muted);
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
