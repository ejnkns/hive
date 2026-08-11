<script lang="ts">
import { slugify } from "shared/slugify";
import { onMount } from "svelte";
import {
  authorFlowDefinition,
  createFlowDefinition,
  deleteFlowDefinition,
  dispatchAction,
  fetchFlow,
  fetchFlowDefinition,
  sendTaskInput,
  updateFlowDefinition,
  validateFlowDefinition,
} from "../flow-api.ts";
import { highlightTypeScript } from "../flow-rendering/ts-highlight.ts";
import Button from "../shared/ui/Button.svelte";
import Dialog from "../shared/ui/Dialog.svelte";
import Textarea from "../shared/ui/Textarea.svelte";
import TextInput from "../shared/ui/TextInput.svelte";
import { flowStore } from "./flow-store.svelte";
import LitFlowHost from "./LitFlowHost.svelte";

let {
  definitionId,
  isNew,
}: {
  definitionId?: string;
  isNew: boolean;
} = $props();

const defaultTemplate = `import { defineWorkflow } from "workflow-engine/workflow-types";

const wf = defineWorkflow({
  id: "my-workflow",
  label: "My Workflow",
  taskOutputs: {} as Record<string, never>,
  states: [
    { id: "idle", label: "Idle", category: "initial" },
    { id: "done", label: "Done", category: "terminal" },
  ],
  initial: "idle",
  terminalStates: ["done"],
});

export const flow = {
  id: "my-flow",
  label: "My Flow",
  configSchema: [
    { key: "title", label: "Title", type: "string", required: true },
  ],
  workflows: [wf],
  edges: [],
};
`;

let name = $state("");
let description = $state("");
let source = $state(defaultTemplate);
let isBuiltIn = $state(false);
let loading = $state(false);
let saving = $state(false);
let validating = $state(false);
let error = $state<string | null>(null);
let aiOpen = $state(true);
let aiPrompt = $state("");
let deleteOpen = $state(false);
// Live generation progress: the current stage, the spec attempt counter, the
// streamed model content, and any rejected attempts so far.
// The flow-authoring session: a hidden flow instance whose ai-chat agent
// converges on a spec with the user. The generic rendering surface shows the
// conversation + Finalize action; the preview panel shows the live rendered TS.
let authorFlowId = $state<string | null>(null);
let authorInstanceId = $state<string | null>(null);
let authoring = $state(false);
let lastAppliedSource = $state<string | null>(null);

// The session flow, live from the store (WS snapshots keep it current).
const authorFlow = $derived(
  authorFlowId ? flowStore.getFlow(authorFlowId) : null
);
const authorSession = $derived(
  authorFlow?.instances.find((instance) => instance.id === authorInstanceId) ??
    null
);

// When the agent's generate_definition tool succeeds, its source lands in
// instance state — drop it into the editor and fill the suggested name.
$effect(() => {
  const generatedSource = authorSession?.state.workflowInstanceState.source;
  if (
    typeof generatedSource !== "string" ||
    generatedSource === "" ||
    generatedSource === lastAppliedSource
  ) {
    return;
  }
  lastAppliedSource = generatedSource;
  source = generatedSource;
  // A new definition needs a name before Save is enabled; the spec's label is
  // the natural one.
  const suggested = authorSession?.state.workflowInstanceState.suggestedName;
  if (name.trim() === "" && typeof suggested === "string" && suggested !== "") {
    name = suggested;
  }
});

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
    const context = isNew
      ? undefined
      : `The user wants changes to this existing definition source:\n\n\`\`\`ts\n${source}\n\`\`\``;
    const { flowId, instanceId } = await authorFlowDefinition({
      prompt: aiPrompt.trim(),
      lucky,
      context,
    });
    authorFlowId = flowId;
    authorInstanceId = instanceId;
    lastAppliedSource = null;
    // Seed the store so the session renders immediately; the WS keeps it live.
    flowStore.upsert(await fetchFlow(flowId));
    localStorage.setItem(authorStorageKey(), flowId);
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to start authoring";
  } finally {
    authoring = false;
  }
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

// The session card's validate/save actions render in the flow-editor's action
// row; the shell executes the app-level effect — REST — because the engine has
// no definition-registration capability yet, so these actions never dispatch
// through the engine. Any other action falls through to dispatch.
async function handleAuthorAction(
  flowId: string,
  instanceId: string,
  actionId: string,
  payload?: Record<string, unknown>
) {
  if (actionId === "validate") {
    await validateSessionSource(flowId, instanceId);
    return;
  }
  if (actionId === "save") {
    await saveSessionDefinition(flowId, instanceId);
    return;
  }
  try {
    await dispatchAction(flowId, instanceId, actionId, payload);
  } catch (err) {
    error = err instanceof Error ? err.message : "Action failed";
  }
}

async function handleAuthorSend(
  flowId: string,
  instanceId: string,
  content: string
) {
  await sendTaskInput(flowId, instanceId, content);
}

// The live session state the shell executes against — the flow-editor renders
// the same state, so what the user sees is what save/validate act on.
async function sessionInstanceState(
  flowId: string,
  instanceId: string
): Promise<Record<string, unknown> | null> {
  const fromStore = flowStore
    .getFlow(flowId)
    ?.instances.find((instance) => instance.id === instanceId);
  if (fromStore) return fromStore.state.workflowInstanceState;
  try {
    const flow = await fetchFlow(flowId);
    return (
      flow.instances.find((instance) => instance.id === instanceId)?.state
        .workflowInstanceState ?? null
    );
  } catch {
    return null;
  }
}

// The session's gate-passed source and suggested name — the artifacts save
// registers. Absent means the agent has not generated a definition yet.
function sessionSavePayload(
  state: Record<string, unknown> | null
): { source: string; name: string } | null {
  const source = typeof state?.source === "string" ? state.source : "";
  if (source === "") return null;
  const suggested =
    typeof state?.suggestedName === "string" ? state.suggestedName : "";
  return { source, name: suggested !== "" ? suggested : (definitionId ?? "") };
}

async function validateSessionSource(flowId: string, instanceId: string) {
  const state = await sessionInstanceState(flowId, instanceId);
  const payload = sessionSavePayload(state);
  if (!payload) {
    error =
      "Nothing to validate — ask the agent to generate a definition first.";
    return;
  }
  validating = true;
  error = null;
  try {
    const result = await validateFlowDefinition(payload.source);
    checkFindings = {
      errors: result.checkErrors,
      warnings: result.checkWarnings,
      typeErrors: result.typeErrors,
      loadError: result.loadError,
    };
  } catch (err) {
    error =
      err instanceof Error ? err.message : "Failed to validate definition";
  } finally {
    validating = false;
  }
}

// The definition id a new-definition session last saved under, so subsequent
// saves update it instead of registering duplicates.
let savedDefinitionId = $state<string | null>(null);

// Save registers the session's generated definition: create for a new
// definition, update for an existing one (or a previously saved one). The
// definition IS saved; consistency findings annotate it — stay in the editor
// to show them, navigate when clean.
async function saveSessionDefinition(flowId: string, instanceId: string) {
  const state = await sessionInstanceState(flowId, instanceId);
  const payload = sessionSavePayload(state);
  if (!payload) {
    error = "Nothing to save — ask the agent to generate a definition first.";
    return;
  }
  saving = true;
  error = null;
  try {
    const targetId = isNew ? savedDefinitionId : definitionId;
    const result = targetId
      ? await updateFlowDefinition(targetId, {
          name: payload.name,
          source: payload.source,
        })
      : await createFlowDefinition({
          name: payload.name,
          source: payload.source,
        });
    savedDefinitionId = result.id;
    const errors = result.checkErrors ?? [];
    const warnings = result.checkWarnings ?? [];
    if (errors.length > 0 || warnings.length > 0) {
      checkFindings = { errors, warnings };
    } else {
      checkFindings = null;
      // Mark the editor clean so the navigation guard does not ask about
      // "unsaved changes" that are already saved (the $effect copied the
      // session's source/name into the manual editor).
      loadedName = payload.name;
      loadedSource = payload.source;
      loadedDescription = description;
      window.location.hash = `#/flows/${encodeURIComponent(result.id)}`;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to save definition";
  } finally {
    saving = false;
  }
}

// Findings from the save path or the validate button (non-blocking).
type CheckFindings = {
  errors: string[];
  warnings: string[];
  typeErrors?: {
    code: number;
    message: string;
    line: number;
    column: number;
  }[];
  loadError?: string;
};
let checkFindings = $state<CheckFindings | null>(null);

let nameWarning = $derived.by(() => {
  if (name.trim() !== "" && slugify(name.trim()) === "new") {
    return '"new" is a reserved definition name';
  }
  return null;
});

// Baseline captured when the definition loads; editing any field past it marks
// the editor dirty for the navigation guard.
let loadedName = $state("");
let loadedDescription = $state("");
let loadedSource = $state(defaultTemplate);
let overlay = $state<HTMLPreElement | null>(null);

const dirty = $derived(
  name !== loadedName ||
    description !== loadedDescription ||
    source !== loadedSource
);

onMount(() => {
  const guardHash = (event: HashChangeEvent) => {
    if (!dirty || window.confirm("You have unsaved changes. Leave anyway?")) {
      return;
    }
    // The navigation was declined — revert the hash to where we were.
    const previous = new URL(event.oldURL).hash;
    window.location.hash = previous;
  };
  const guardUnload = (event: BeforeUnloadEvent) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = "";
  };
  window.addEventListener("hashchange", guardHash);
  window.addEventListener("beforeunload", guardUnload);

  void load();
  void resumeAuthoring();
  return () => {
    window.removeEventListener("hashchange", guardHash);
    window.removeEventListener("beforeunload", guardUnload);
  };
});

async function load() {
  if (isNew || !definitionId) {
    loadedName = "";
    loadedDescription = "";
    loadedSource = defaultTemplate;
    return;
  }
  loading = true;
  error = null;
  try {
    const detail = await fetchFlowDefinition(definitionId);
    isBuiltIn = detail.builtIn;
    name = detail.name;
    description = detail.description ?? "";
    source = detail.source ?? defaultTemplate;
    loadedName = detail.name;
    loadedDescription = detail.description ?? "";
    loadedSource = detail.source ?? defaultTemplate;
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load definition";
  } finally {
    loading = false;
  }
}

function syncScroll(event: Event) {
  const textarea = event.currentTarget as HTMLTextAreaElement;
  if (overlay !== null) {
    overlay.scrollTop = textarea.scrollTop;
    overlay.scrollLeft = textarea.scrollLeft;
  }
}

async function validate() {
  validating = true;
  error = null;
  try {
    const result = await validateFlowDefinition(source);
    checkFindings = {
      errors: result.checkErrors,
      warnings: result.checkWarnings,
      typeErrors: result.typeErrors,
      loadError: result.loadError,
    };
  } catch (err) {
    error =
      err instanceof Error ? err.message : "Failed to validate definition";
  } finally {
    validating = false;
  }
}

async function save() {
  if (!name.trim()) {
    error = "Definition name is required";
    return;
  }
  if (nameWarning) {
    error = nameWarning;
    return;
  }
  saving = true;
  error = null;
  try {
    const result = isNew
      ? await createFlowDefinition({ name: name.trim(), description, source })
      : await updateDefinition(definitionId);
    // The definition IS saved. Consistency errors/warnings annotate it —
    // stay in the editor so the author sees them; navigate when clean.
    const errors = result.checkErrors ?? [];
    const warnings = result.checkWarnings ?? [];
    if (errors.length > 0 || warnings.length > 0) {
      checkFindings = { errors, warnings };
    } else {
      checkFindings = null;
      // The definition IS saved — mark the editor clean so the navigation
      // guard does not ask about "unsaved changes" that are already saved.
      loadedName = name;
      loadedDescription = description;
      loadedSource = source;
      window.location.hash = `#/flows/${encodeURIComponent(result.id)}`;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to save definition";
  } finally {
    saving = false;
  }
}

async function updateDefinition(id: string | undefined) {
  if (id === undefined) {
    throw new Error("Definition id is missing");
  }
  return updateFlowDefinition(id, {
    name: name.trim(),
    description,
    source,
  });
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

  <h1>{isNew ? "New flow definition" : `Edit ${definitionId}`}</h1>

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
    <div class="name-row">
      <label class="field">
        <span class="label">Name</span>
        <TextInput bind:value={name} placeholder="My Flow" />
        {#if nameWarning}
          <span class="hint warning">{nameWarning}</span>
        {/if}
      </label>
      {#if !isNew}
        <label class="field">
          <span class="label">Slug (read-only)</span>
          <TextInput value={definitionId ?? ""} disabled />
        </label>
      {/if}
      <label class="field">
        <span class="label">Description</span>
        <TextInput
          bind:value={description}
          placeholder="What does this flow do?"
        />
      </label>
    </div>

    <div class="panes" data-session={authorFlowId ? "true" : "false"}>
      <div class="ai-pane">
        <div class="pane-header">
          <button
            type="button"
            class="pane-toggle"
            onclick={() => (aiOpen = !aiOpen)}
          >
            {aiOpen ? "Hide" : "Show"}
            AI
          </button>
        </div>
        {#if aiOpen}
          <div class="ai-body">
            {#if authorFlowId && authorFlow}
              <!-- The authoring session renders as a flow instance: the
                   built-in flow-editor composes the session header, the
                   running chat, the tokenized spec preview, and the
                   validate/save action row. The shell only mounts the
                   rendering surface. -->
              <LitFlowHost
                flowId={authorFlow.id}
                workflowDefs={authorFlow.workflows}
                instances={authorFlow.instances}
                customKinds={authorFlow.ui?.kinds ?? []}
                components={authorFlow.ui?.components ?? {}}
                onAction={handleAuthorAction}
                onSendMessage={handleAuthorSend}
              />
            {:else}
              <p class="ai-hint">
                Describe the flow you want. The agent will ask what is unclear,
                then draft the definition with you — or try "I'm feeling lucky"
                for a one-shot attempt.
              </p>
              <Textarea
                bind:value={aiPrompt}
                placeholder="A review flow: a ready state with an approve/reject action..."
              />
              <Button
                variant="azure"
                block
                disabled={authoring || !aiPrompt.trim()}
                onclick={() => startAuthoring(false)}
              >
                {authoring ? "Starting session..." : "Start conversation"}
              </Button>
              <Button
                variant="platinum"
                block
                disabled={authoring || !aiPrompt.trim()}
                onclick={() => startAuthoring(true)}
              >
                I'm feeling lucky
              </Button>
            {/if}
          </div>
        {/if}
      </div>

      <div class="ts-pane">
        <div class="pane-header">
          <span class="pane-title">Definition source (.ts)</span>
        </div>
        <div class="code-editor">
          <pre
            class="code-overlay"
            bind:this={overlay}
            aria-hidden="true"
          >{@html highlightTypeScript(source)}</pre>
          <Textarea
            bind:value={source}
            rows={30}
            restProps={{ spellcheck: false, onscroll: syncScroll }}
          />
        </div>
        {#if error}
          <div class="editor-error">{error}</div>
        {/if}
      </div>
    </div>

    {#if checkFindings}
      <div class="report save-findings">
        {#if checkFindings.loadError}
          <p class="report-bad">Definition failed to load:</p>
          <ul class="report-list">
            <li>{checkFindings.loadError}</li>
          </ul>
        {/if}
        {#if checkFindings.errors.length > 0 || (checkFindings.typeErrors?.length ?? 0) > 0}
          <p class="report-bad">
            {#if checkFindings.loadError}
              Consistency findings:
            {:else}
              Findings:
            {/if}
          </p>
          {#if checkFindings.errors.length > 0}
            <ul class="report-list">
              {#each checkFindings.errors as e}
                <li>{e}</li>
              {/each}
            </ul>
          {/if}
          {#if (checkFindings.typeErrors?.length ?? 0) > 0}
            <p class="report-warn-head">Type errors:</p>
            <ul class="report-list">
              {#each checkFindings.typeErrors ?? [] as t}
                <li>{t.line}:{t.column} — {t.message}</li>
              {/each}
            </ul>
          {/if}
        {/if}
        {#if checkFindings.warnings.length > 0}
          <p class="report-warn-head">Warnings:</p>
          <ul class="report-list">
            {#each checkFindings.warnings as w}
              <li>{w}</li>
            {/each}
          </ul>
        {/if}
        {#if !checkFindings.loadError && checkFindings.errors.length === 0 && (checkFindings.typeErrors?.length ?? 0) === 0}
          <p class="report-ok">
            Definition loads, typechecks, and holds the schema contract.
          </p>
        {/if}
        {#if checkFindings.errors.length > 0 || (checkFindings.typeErrors?.length ?? 0) > 0}
          <p class="report-note">
            The definition is saved and usable; fix the findings to keep the
            schema contract clean, then validate again.
          </p>
        {/if}
      </div>
    {/if}

    <div class="footer">
      <div class="footer-actions">
        <Button variant="platinum" disabled={validating} onclick={validate}>
          {validating ? "Validating..." : "Validate"}
        </Button>
        <Button variant="mint" disabled={saving || !name.trim()} onclick={save}>
          {saving ? "Saving..." : "Save definition"}
        </Button>
        {#if !isNew}
          <Button variant="rose" onclick={() => (deleteOpen = true)}>
            Delete this flow definition
          </Button>
        {/if}
      </div>
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

h1 {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text);
  margin: 0 0 1.5rem 0;
}

.name-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 1rem;
  margin-bottom: 1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.hint.warning {
  color: var(--warning);
}

.panes {
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: 1rem;
}

/* With an authoring session active the AI pane is the focus — the chat and
   spec preview need width; the TS editor stays visible alongside it. */
.panes[data-session="true"] {
  grid-template-columns: minmax(440px, 3fr) minmax(320px, 2fr);
}

.pane-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.375rem 0;
}

.pane-toggle {
  border: none;
  background: transparent;
  color: var(--accent);
  font-family: monospace;
  font-size: 0.6875rem;
  cursor: pointer;
}

.pane-title {
  font-size: 0.625rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 700;
}

.ai-body {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.ai-hint {
  font-size: 0.75rem;
  color: var(--muted);
  line-height: 1.4;
  margin: 0;
}

.code-editor {
  position: relative;
}

.code-editor :global(textarea) {
  position: relative;
  z-index: 1;
  background: transparent;
  color: transparent;
  caret-color: var(--text);
  font-family: var(--font-mono, monospace);
  font-size: 0.75rem;
  line-height: 1.5;
  tab-size: 2;
}

.code-overlay {
  position: absolute;
  inset: 0;
  z-index: 0;
  margin: 0;
  padding: 8px 12px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: var(--surface);
  font-family: var(--font-mono, monospace);
  font-size: 0.75rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  overflow: hidden;
  pointer-events: none;
}

.code-overlay :global(.tok-keyword) {
  color: var(--accent);
}

.code-overlay :global(.tok-string) {
  color: var(--success);
}

.code-overlay :global(.tok-number) {
  color: var(--warning);
}

.code-overlay :global(.tok-comment) {
  color: var(--muted);
  font-style: italic;
}

.editor-error {
  background: rgba(220, 60, 60, 0.1);
  border: 1px solid rgba(220, 60, 60, 0.3);
  color: #dc3c3c;
  padding: 0.5rem 0.75rem;
  border-radius: 4px;
  font-size: 0.75rem;
  margin-top: 0.5rem;
  white-space: pre-wrap;
}

.report {
  background: rgba(250, 200, 60, 0.06);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.625rem 0.75rem;
  font-size: 0.6875rem;
  line-height: 1.5;
  color: var(--muted);
  overflow-wrap: anywhere;
}

.report-ok {
  color: var(--success);
  margin: 0;
}

.report-bad {
  color: var(--warning);
  margin: 0 0 0.25rem 0;
  font-weight: 600;
}

.report-warn-head {
  margin: 0.5rem 0 0.125rem 0;
  font-weight: 600;
  color: var(--text);
}

.report-list {
  margin: 0;
  padding-left: 1.125rem;
}

.report-note {
  margin: 0.5rem 0 0 0;
  font-style: italic;
}

.save-findings {
  margin-top: 1rem;
}

.footer {
  margin-top: 1.5rem;
}

.footer-actions {
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
