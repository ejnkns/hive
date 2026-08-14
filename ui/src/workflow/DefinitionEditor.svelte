<script lang="ts">
import { onMount } from "svelte";
import type { FlowDefinitionDetail } from "../flow-api.ts";
import {
  authorFlowDefinition,
  deleteFlow,
  deleteFlowDefinition,
  dispatchAction,
  fetchFlow,
  fetchFlowDefinition,
  saveAuthoringDefinition,
  saveAuthoringFile,
  saveAuthoringSource,
  sendTaskInput,
  updateFlowDefinition,
} from "../flow-api.ts";
// Importing the code-editor module registers the <code-editor> element used
// by the no-session files editor (the session renders its own via flow-editor).
import type { CodeEditor } from "../flow-rendering/components/code-editor.ts";
import "../flow-rendering/components/code-editor.ts";
import Button from "../shared/ui/Button.svelte";
import Dialog from "../shared/ui/Dialog.svelte";
import Textarea from "../shared/ui/Textarea.svelte";
import { flowStore } from "./flow-store.svelte";
import LitFlowHost from "./LitFlowHost.svelte";

// The flow definition editor: the authoring session (a hidden flow instance)
// is the AI collaborator on the flow's files — but the files are the
// persistent artifact and stay visible and editable whether the session is
// active or not. The shell keeps the route, the session lifecycle
// (start/close), and the no-session files editor (tabs + explicit save);
// the active session renders through the flow-editor instance component.

let {
  definitionId,
  isNew,
}: {
  definitionId?: string;
  isNew: boolean;
} = $props();

let isBuiltIn = $state(false);
// The saved definition's detail (name, source, files) — the persistent files
// the no-session state shows and edits.
let savedDetail = $state<FlowDefinitionDetail | null>(null);
let loading = $state(false);
let error = $state<string | null>(null);
let aiPrompt = $state("");
let deleteOpen = $state(false);
let authoring = $state(false);

// The authoring session: a hidden flow instance whose ai-chat agent converges
// on a definition with the user. The flow-editor renders it — chat, the
// editable definition module, save.
let authorFlowId = $state<string | null>(null);
let authorInstanceId = $state<string | null>(null);

// The session flow, live from the store (WS snapshots keep it current).
const authorFlow = $derived(
  authorFlowId ? flowStore.getFlow(authorFlowId) : null
);

// The no-session files editor: the active tab, the human's in-flight edits
// per tab (overriding the saved value until Save), and the save status.
let activeTab = $state("definition");
let editedValues = $state<Record<string, string>>({});
let saving = $state(false);
let saveStatus = $state<string | null>(null);
let editor: CodeEditor | null = $state(null);

const filePaths = $derived(
  savedDetail ? Object.keys(savedDetail.files ?? {}).sort() : []
);

const activeValue = $derived(
  activeTab === "definition"
    ? (editedValues.definition ?? savedDetail?.source ?? "")
    : (editedValues[activeTab] ?? savedDetail?.files?.[activeTab] ?? "")
);

const hasPendingEdits = $derived(Object.keys(editedValues).length > 0);

// Resume a session after a reload: the session flow persists server-side; the
// editor remembers its id per definition.
function authorStorageKey(): string {
  return `hive:author:${definitionId ?? "new"}`;
}

// After saving a NEW definition, re-key the session under the saved id and
// route to its edit page: the session becomes the definition's own session
// (resumable at #/flows/<id>/edit), and the definition's page — with the
// instantiate form — is one hop away. Guards against re-firing for the same
// saved id within the mount.
let routedSavedId = "";

$effect(() => {
  if (isNew) {
    routedSavedId = "";
  }
  if (!isNew || !authorFlowId) return;
  const savedId =
    typeof authorFlow?.instances?.[0]?.state.workflowInstanceState
      ?.savedDefinitionId === "string"
      ? authorFlow.instances[0].state.workflowInstanceState.savedDefinitionId
      : "";
  if (savedId === "" || savedId === routedSavedId) return;
  routedSavedId = savedId;
  localStorage.removeItem(authorStorageKey());
  localStorage.setItem(`hive:author:${savedId}`, authorFlowId);
  window.location.hash = `#/flows/${encodeURIComponent(savedId)}/edit`;
});

// The no-session code editor is controlled: the shell owns its value.
$effect(() => {
  if (editor !== null) editor.value = activeValue;
});

async function startAuthoring(lucky: boolean) {
  if (!aiPrompt.trim()) return;
  authoring = true;
  error = null;
  try {
    // When revising an existing definition, hand the agent its current source
    // so it can propose changes rather than designing from scratch.
    let context: string | undefined;
    let files: Record<string, string> | undefined;
    if (!isNew && definitionId) {
      const detail = await fetchFlowDefinition(definitionId);
      context = `The user wants changes to this existing definition source:\n\n\`\`\`ts\n${detail.source ?? ""}\n\`\`\``;
      // Seed the revision session with the existing definition's referenced
      // files so the editor tabs and the agent's file tools see them.
      files =
        detail.files !== null &&
        typeof detail.files === "object" &&
        !Array.isArray(detail.files)
          ? (detail.files as Record<string, string>)
          : undefined;
    }
    const { flowId, instanceId } = await authorFlowDefinition({
      prompt: aiPrompt.trim(),
      lucky,
      context,
      files,
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

// Starting a conversation from the no-session files editor: persist any
// unsaved edits first so the session seeds from the current content.
async function startAuthoringFromFiles(lucky: boolean) {
  if (authoring || !aiPrompt.trim()) return;
  if (hasPendingEdits) {
    const ok = await saveDefinition();
    if (!ok) return; // the save failed — do not start on stale state
  }
  await startAuthoring(lucky);
}

// Closes (deletes) the authoring session flow and returns the pane to the
// persistent files editor. The session is disposable — a failed delete is
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
  // The session's save may have updated the definition; refresh the files the
  // no-session editor shows.
  void refreshDetail();
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

// The flow-editor emits hive-action for its Save button ("save") and the
// "done" affordance ("instantiate"); the shell executes the app-level effect.
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
  // The "done" affordance: once the definition is saved, send the user to the
  // definition's page (where the instantiate form lives).
  if (actionId === "instantiate") {
    const id = typeof payload?.id === "string" ? payload.id : "";
    if (id !== "") {
      window.location.hash = `#/flows/${encodeURIComponent(id)}`;
    }
    return;
  }
  try {
    await dispatchAction(flowId, instanceId, actionId, payload);
  } catch (err) {
    error = err instanceof Error ? err.message : "Action failed";
  }
}

// The flow-editor's editable panes write back through onPatchState: the
// human's current definition module (`source` — the single artifact; the edit
// IS the state) and referenced files (`files`, authoritative). Each write-back
// route is flow-scoped, so the instanceId is not needed.
function handleAuthorPatch(
  flowId: string,
  _instanceId: string,
  values: Record<string, unknown>
) {
  const source = typeof values.source === "string" ? values.source : "";
  if (source !== "") {
    void saveAuthoringSource(flowId, source).catch((err) => {
      error = err instanceof Error ? err.message : "Failed to save source";
    });
  }
  const files =
    values.files !== null &&
    typeof values.files === "object" &&
    !Array.isArray(values.files)
      ? (values.files as Record<string, string>)
      : {};
  for (const [path, content] of Object.entries(files)) {
    if (typeof content !== "string" || content === "") continue;
    void saveAuthoringFile(flowId, path, content).catch((err) => {
      error = err instanceof Error ? err.message : "Failed to save file";
    });
  }
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

// ── the no-session files editor ───────────────────────────────────────

function selectTab(tab: string) {
  activeTab = tab;
}

function handleFileEdit(event: CustomEvent<{ value: string }>) {
  editedValues[activeTab] = event.detail.value;
  saveStatus = null;
}

// The explicit save: PUT the current source + files to the definition-update
// route (the same registration seam the session save uses). Returns whether
// the save succeeded, so a caller can decide whether to proceed on the saved
// state.
async function saveDefinition(): Promise<boolean> {
  if (!definitionId || !savedDetail || saving) return false;
  saving = true;
  error = null;
  saveStatus = null;
  const source = editedValues.definition ?? savedDetail.source ?? "";
  const files = { ...(savedDetail.files ?? {}) };
  for (const [path, content] of Object.entries(editedValues)) {
    if (path === "definition") continue;
    files[path] = content;
  }
  try {
    await updateFlowDefinition(definitionId, {
      name: savedDetail.name,
      description: savedDetail.description,
      source,
      files,
    });
    savedDetail = { ...savedDetail, source, files };
    editedValues = {};
    saveStatus = "Saved";
    return true;
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to save definition";
    return false;
  } finally {
    saving = false;
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
    await refreshDetail();
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load definition";
  } finally {
    loading = false;
  }
}

// Re-fetches the saved definition's detail without the loading flash (used
// when the session closes and may have updated the files).
async function refreshDetail() {
  if (isNew || !definitionId) return;
  const detail = await fetchFlowDefinition(definitionId);
  isBuiltIn = detail.builtIn;
  savedDetail = detail;
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
  {:else if authorFlowId && authorFlow}
    <!-- The authoring session renders as a flow instance: the flow-editor
         composes the header, the chat with Save, and the editable
         definition module. The shell only mounts the rendering surface and
         owns the session lifecycle. -->
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
  {:else if isNew}
    <div class="start-session">
      <p class="ai-hint">
        Describe the flow you want. The agent will ask what is unclear, then
        draft the definition module with you — or try "I'm feeling lucky" for a
        one-shot attempt. The definition renders as the session's editable
        editor; you can edit the TypeScript directly at any time (your edits ARE
        the state — the agent's next turn reads them).
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
  {:else}
    <!-- A saved definition with no active session: the persistent files are
         always visible and editable — the session is a collaborator, not the
         only way to see the flow. -->
    <div class="session-bar">
      <div class="session-prompt">
        <Textarea
          bind:value={aiPrompt}
          rows={1}
          placeholder="What would you like to change about this definition? The agent reads your current source and revises it with you."
        />
      </div>
      <div class="start-actions">
        <Button
          variant="azure"
          disabled={authoring || !aiPrompt.trim()}
          onclick={() => startAuthoringFromFiles(false)}
        >
          {authoring ? "Starting session..." : "Start conversation"}
        </Button>
        <Button
          variant="platinum"
          disabled={authoring || !aiPrompt.trim()}
          onclick={() => startAuthoringFromFiles(true)}
        >
          I'm feeling lucky
        </Button>
      </div>
    </div>
    <div class="tab-bar">
      <button
        type="button"
        class:active={activeTab === "definition"}
        onclick={() => selectTab("definition")}
      >
        Definition
      </button>
      {#each filePaths as path (path)}
        <button
          type="button"
          class:active={activeTab === path}
          onclick={() => selectTab(path)}
        >
          {path}
        </button>
      {/each}
    </div>
    <div class="pane">
      <div class="pane-head">
        <span class="pane-title">
          {activeTab === "definition" ? "Definition module (.ts)" : activeTab}
        </span>
      </div>
      <code-editor
        bind:this={editor}
        onhive-code-change={handleFileEdit}
      ></code-editor>
    </div>
    <div class="files-actions">
      <Button
        variant="azure"
        size="small"
        disabled={!hasPendingEdits || saving}
        onclick={() => void saveDefinition()}
      >
        {saving ? "Saving..." : "Save definition"}
      </Button>
      {#if saveStatus}
        <span class="saved-status">{saveStatus}</span>
      {/if}
    </div>
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

.session-bar {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.session-prompt {
  flex: 1;
  min-width: 0;
}

.tab-bar {
  display: flex;
  gap: 0.25rem;
  flex-wrap: wrap;
  margin-bottom: 0.375rem;
}

.tab-bar button {
  font-family: inherit;
  font-size: 0.625rem;
  height: 24px;
  padding: 0 0.5rem;
  border-radius: 4px 4px 0 0;
  border: 1px solid var(--border);
  border-bottom: none;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  max-width: 14rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tab-bar button:hover {
  color: var(--text);
}

.tab-bar button.active {
  background: var(--bg);
  color: var(--text);
  font-weight: 600;
}

.pane {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.5rem;
}

.pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.375rem;
}

.pane-title {
  font-size: 0.5625rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 700;
}

.files-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.saved-status {
  font-size: 0.625rem;
  color: var(--success);
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
  flex: none;
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
