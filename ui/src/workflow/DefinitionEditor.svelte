<script lang="ts">
import { slugify } from "shared/slugify";
import { onMount } from "svelte";
import Button from "../shared/ui/Button.svelte";
import Dialog from "../shared/ui/Dialog.svelte";
import Textarea from "../shared/ui/Textarea.svelte";
import TextInput from "../shared/ui/TextInput.svelte";
import { highlightTypeScript } from "./DefinitionEditor/highlight";
import {
  createFlowDefinition,
  deleteFlowDefinition,
  fetchFlowDefinition,
  type GenerationReport,
  generateFlowDefinition,
  updateFlowDefinition,
} from "./flow-api";

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
let generating = $state(false);
let error = $state<string | null>(null);
let aiOpen = $state(true);
let aiPrompt = $state("");
let deleteOpen = $state(false);
// The last generation's gate outcome (errors = why the definition still
// fails the schema/typecheck gate; the source is still loaded for editing).
let generationReport = $state<GenerationReport | null>(null);
// Schema-consistency findings from the save path (non-blocking annotation).
let checkFindings = $state<{ errors: string[]; warnings: string[] } | null>(
  null
);

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

async function generate() {
  if (!aiPrompt.trim()) return;
  generating = true;
  error = null;
  generationReport = null;
  try {
    const result = await generateFlowDefinition(aiPrompt.trim());
    source = result.source;
    generationReport = result.report;
  } catch (err) {
    error =
      err instanceof Error ? err.message : "Failed to generate definition";
  } finally {
    generating = false;
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

    <div class="panes">
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
            <p class="ai-hint">
              Describe the flow you want; the model returns a TypeScript
              definition matching the engine schema.
            </p>
            <Textarea
              bind:value={aiPrompt}
              placeholder="A review flow: a ready state with an approve/reject action..."
            />
            <Button
              variant="azure"
              block
              disabled={generating || !aiPrompt.trim()}
              onclick={generate}
            >
              {generating ? "Generating..." : "Generate"}
            </Button>
            {#if generationReport}
              <div class="report">
                {#if generationReport.passed}
                  <p class="report-ok">
                    Definition passed the gate ({generationReport.attempts}
                    attempt
                    {#if generationReport.attempts !== 1}
                      s
                    {/if}
                    ) — typecheck and schema-consistency are clean.
                  </p>
                {:else}
                  <p class="report-bad">
                    Definition failed the gate after
                    {generationReport.attempts}
                    attempts. It was loaded for editing, but these issues
                    remain:
                  </p>
                  <ul class="report-list">
                    {#each generationReport.errors as err}
                      <li>{err}</li>
                    {/each}
                  </ul>
                {/if}
                {#if generationReport.warnings.length > 0}
                  <p class="report-warn-head">Warnings:</p>
                  <ul class="report-list">
                    {#each generationReport.warnings as w}
                      <li>{w}</li>
                    {/each}
                  </ul>
                {/if}
              </div>
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
        <p class="report-bad">Definition saved. Schema-consistency findings:</p>
        {#if checkFindings.errors.length > 0}
          <p class="report-warn-head">Errors:</p>
          <ul class="report-list">
            {#each checkFindings.errors as e}
              <li>{e}</li>
            {/each}
          </ul>
        {/if}
        {#if checkFindings.warnings.length > 0}
          <p class="report-warn-head">Warnings:</p>
          <ul class="report-list">
            {#each checkFindings.warnings as w}
              <li>{w}</li>
            {/each}
          </ul>
        {/if}
        <p class="report-note">
          The definition is saved and usable; fix the findings to keep the
          schema contract clean, then save again to continue.
        </p>
      </div>
    {/if}

    <div class="footer">
      <div class="footer-actions">
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
