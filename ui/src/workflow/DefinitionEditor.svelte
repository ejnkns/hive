<script lang="ts">
import { onMount } from "svelte";
import {
  authorFlowDefinition,
  deleteFlow,
  deleteFlowDefinition,
  discardAuthoringSource,
  dispatchAction,
  fetchFlow,
  fetchFlowDefinition,
  saveAuthoringDefinition,
  saveAuthoringSource,
  sendTaskInput,
} from "../flow-api.ts";
import Button from "../shared/ui/Button.svelte";
import Dialog from "../shared/ui/Dialog.svelte";
import Textarea from "../shared/ui/Textarea.svelte";
import { flowStore } from "./flow-store.svelte";
import LitFlowHost from "./LitFlowHost.svelte";

// The flow definition editor, session-scoped: the authoring session (a
// hidden flow instance) IS the editor. The shell keeps the route, the
// start-session state, the session lifecycle (start/close), and the REST
// execution for the flow-editor's actions and write-back; everything else —
// chat, the editable definition source, save, discard — renders through the
// flow-editor instance component.

let {
  definitionId,
  isNew,
}: {
  definitionId?: string;
  isNew: boolean;
} = $props();

let isBuiltIn = $state(false);
let loading = $state(false);
let error = $state<string | null>(null);
let aiPrompt = $state("");
let deleteOpen = $state(false);
let authoring = $state(false);

// The authoring session: a hidden flow instance whose ai-chat agent converges
// on a spec with the user. The flow-editor renders it — chat, the editable
// definition source, save, discard.
let authorFlowId = $state<string | null>(null);
let authorInstanceId = $state<string | null>(null);

// The session flow, live from the store (WS snapshots keep it current).
const authorFlow = $derived(
  authorFlowId ? flowStore.getFlow(authorFlowId) : null
);

// Resume a session after a reload: the session flow persists server-side; the
// editor remembers its id per definition.
function authorStorageKey(): string {
  return `hive:author:${definitionId ?? "new"}`;
}

async function startAuthoring(lucky: boolean) {
  if (!aiPrompt.trim()) return;
  authoring = true;
  error = null;
  try {
    // When revising an existing definition, hand the agent its current source
    // so it can propose changes rather than designing from scratch.
    let context: string | undefined;
    if (!isNew && definitionId) {
      const detail = await fetchFlowDefinition(definitionId);
      context = `The user wants changes to this existing definition source:\n\n\`\`\`ts\n${detail.source ?? ""}\n\`\`\``;
    }
    const { flowId, instanceId } = await authorFlowDefinition({
      prompt: aiPrompt.trim(),
      lucky,
      context,
    });
    authorFlowId = flowId;
    authorInstanceId = instanceId;
    // Seed the store so the session renders immediately; the WS keeps it live.
    flowStore.upsert(await fetchFlow(flowId));
    localStorage.setItem(authorStorageKey(), flowId);
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to start authoring";
  } finally {
    authoring = false;
  }
}

// Closes (deletes) the authoring session flow and returns the pane to the
// start-conversation state. The session is disposable — a failed delete is
// not an error; the stored key is cleared either way.
async function closeAuthoring() {
  if (!authorFlowId) return;
  try {
    await deleteFlow(authorFlowId, true);
  } catch {
    // The session is disposable; a failed delete is not an error.
  }
  flowStore.removeFlow(authorFlowId);
  localStorage.removeItem(authorStorageKey());
  authorFlowId = null;
  authorInstanceId = null;
}

async function resumeAuthoring(): Promise<void> {
  // A new definition always starts fresh: the previous new-definition session
  // (keyed "new") must not leak in — its source and "done" state are stale.
  if (isNew) {
    localStorage.removeItem(authorStorageKey());
    return;
  }
  const stored = localStorage.getItem(authorStorageKey());
  if (!stored) return;
  try {
    const flow = await fetchFlow(stored);
    const instance = flow.instances[0];
    // Only resume an in-progress session. A finished session on a fresh editor
    // visit would re-apply its stale source over whatever is loaded now.
    if (
      !instance ||
      instance.state.currentState === "done" ||
      instance.state.currentState === "failed"
    ) {
      localStorage.removeItem(authorStorageKey());
      return;
    }
    flowStore.upsert(flow);
    authorFlowId = flow.id;
    authorInstanceId = instance.id;
  } catch {
    // The stored session is gone (deleted server-side); forget it.
    localStorage.removeItem(authorStorageKey());
  }
}

// The flow-editor emits hive-action for its Save button ("save") and Discard
// handoff ("discard"); the shell executes the app-level effect (REST).
// Any other action falls through to dispatch.
async function handleAuthorAction(
  flowId: string,
  instanceId: string,
  actionId: string,
  payload?: Record<string, unknown>
) {
  if (actionId === "save") {
    await saveFromSession(flowId);
    return;
  }
  if (actionId === "discard") {
    await discardEdits(flowId);
    return;
  }
  try {
    await dispatchAction(flowId, instanceId, actionId, payload);
  } catch (err) {
    error = err instanceof Error ? err.message : "Action failed";
  }
}

// The flow-editor's editable source writes back through onPatchState: the
// human's current definition, patched into the session (spec diverged). The
// write-back route is flow-scoped, so the instanceId is not needed.
function handleAuthorPatch(
  flowId: string,
  _instanceId: string,
  values: Record<string, unknown>
) {
  const source = typeof values.source === "string" ? values.source : "";
  if (source === "") return;
  void saveAuthoringSource(flowId, source).catch((err) => {
    error = err instanceof Error ? err.message : "Failed to save source";
  });
}

async function handleAuthorSend(
  flowId: string,
  instanceId: string,
  content: string
) {
  await sendTaskInput(flowId, instanceId, content);
}

// The synchronous session save (the flow-editor renders the result from the
// patched instance state); failures surface here.
async function saveFromSession(flowId: string) {
  error = null;
  try {
    await saveAuthoringDefinition(flowId);
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to save definition";
  }
}

// Discard handoff: clears the divergence so the agent's next generate wins.
async function discardEdits(flowId: string) {
  error = null;
  try {
    await discardAuthoringSource(flowId);
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to discard edits";
  }
}

onMount(() => {
  void load();
  void resumeAuthoring();
});

async function load() {
  if (isNew || !definitionId) {
    isBuiltIn = false;
    return;
  }
  loading = true;
  error = null;
  try {
    const detail = await fetchFlowDefinition(definitionId);
    isBuiltIn = detail.builtIn;
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load definition";
  } finally {
    loading = false;
  }
}

async function remove() {
  if (!definitionId) return;
  try {
    await deleteFlowDefinition(definitionId);
    window.location.hash = "#/flows";
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to delete definition";
  }
}
</script>

<div class="editor">
  <div class="breadcrumb">
    <a href="#/flows">Flows</a>
    <span class="crumb-sep">/</span>
    {#if isNew}
      <span class="crumb-current">New flow definition</span>
    {:else}
      <a href={`#/flows/${encodeURIComponent(definitionId ?? "")}`}
        >{definitionId}</a
      >
      <span class="crumb-sep">/</span>
      <span class="crumb-current">Edit</span>
    {/if}
  </div>

  <div class="header-row">
    <h1>{isNew ? "New flow definition" : `Edit ${definitionId}`}</h1>
    {#if !isNew && !isBuiltIn}
      <Button variant="rose" size="small" onclick={() => (deleteOpen = true)}>
        Delete this flow definition
      </Button>
    {/if}
  </div>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if loading}
    <div class="loading">Loading definition...</div>
  {:else if isBuiltIn}
    <div class="builtin-notice">
      Built-in flow definitions ship with the server and cannot be edited.
      Existing instances use their snapshot of this definition.
    </div>
  {:else}
    {#if authorFlowId && authorFlow}
      <!-- The authoring session renders as a flow instance: the flow-editor
           composes the header, the chat with Save, and the editable
           definition source with the discard handoff. The shell only mounts
           the rendering surface and owns the session lifecycle. -->
      <div class="author-toolbar">
        <button type="button" class="author-close" onclick={closeAuthoring}>
          Close session
        </button>
      </div>
      <LitFlowHost
        flowId={authorFlow.id}
        workflowDefs={authorFlow.workflows}
        instances={authorFlow.instances}
        customKinds={authorFlow.ui?.kinds ?? []}
        components={authorFlow.ui?.components ?? {}}
        onAction={handleAuthorAction}
        onSendMessage={handleAuthorSend}
        onPatchState={handleAuthorPatch}
      />
    {:else}
      <div class="start-session">
        <p class="ai-hint">
          Describe the flow you want. The agent will ask what is unclear, then
          draft the definition with you — or try "I'm feeling lucky" for a
          one-shot attempt. The definition renders as the session's editable
          editor; you can edit the TypeScript directly at any time.
        </p>
        <Textarea
          bind:value={aiPrompt}
          placeholder="A review flow: a ready state with an approve/reject action..."
        />
        <div class="start-actions">
          <Button
            variant="azure"
            disabled={authoring || !aiPrompt.trim()}
            onclick={() => startAuthoring(false)}
          >
            {authoring ? "Starting session..." : "Start conversation"}
          </Button>
          <Button
            variant="platinum"
            disabled={authoring || !aiPrompt.trim()}
            onclick={() => startAuthoring(true)}
          >
            I'm feeling lucky
          </Button>
        </div>
      </div>
    {/if}
  {/if}
</div>

<Dialog bind:open={deleteOpen} label="Delete flow definition">
  <h2 class="dialog-title">Delete flow definition</h2>
  <p class="dialog-text">
    Existing instances keep their snapshot of this definition, but the
    definition will no longer be listed or instantiable.
  </p>
  <Button variant="rose" onclick={remove}>Delete definition</Button>
</Dialog>

<style>
.editor {
  max-width: 1000px;
  margin: 0 auto;
  padding: 2rem 1.25rem;
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.6875rem;
  color: var(--muted);
  margin-bottom: 0.5rem;
}

.breadcrumb a {
  color: var(--muted);
  text-decoration: none;
}

.breadcrumb a:hover {
  color: var(--text);
}

.crumb-sep {
  opacity: 0.5;
}

.crumb-current {
  color: var(--text);
}

.header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

h1 {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text);
  margin: 0;
}

.author-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 0.5rem;
}

.author-close {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--muted);
  font-size: 0.625rem;
  padding: 0.25rem 0.5rem;
  cursor: pointer;
}

.author-close:hover {
  color: var(--error);
  border-color: var(--error);
}

.start-session {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-width: 480px;
}

.ai-hint {
  font-size: 0.75rem;
  color: var(--muted);
  line-height: 1.4;
  margin: 0;
}

.start-actions {
  display: flex;
  gap: 0.5rem;
}

.loading {
  text-align: center;
  padding: 3rem 1rem;
  color: var(--muted);
  font-size: 0.875rem;
}

.builtin-notice {
  background: rgba(250, 200, 60, 0.08);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--muted);
  font-size: 0.8125rem;
  line-height: 1.5;
  padding: 1rem 1.25rem;
}

.error {
  background: rgba(220, 60, 60, 0.1);
  border: 1px solid rgba(220, 60, 60, 0.3);
  color: #dc3c3c;
  padding: 0.75rem 1rem;
  border-radius: 6px;
  font-size: 0.8125rem;
  margin-bottom: 1rem;
}

.dialog-title {
  margin: 0 0 0.75rem 0;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
}

.dialog-text {
  font-size: 0.8125rem;
  color: var(--muted);
  line-height: 1.5;
  margin: 0 0 1rem 0;
}
</style>
