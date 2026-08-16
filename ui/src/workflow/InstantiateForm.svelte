<script lang="ts">
import type { FlowCreateForm } from "../flow-rendering/components/flow-create-form.ts";

// The route shell for creating a flow instance: breadcrumb + heading, then
// the built-in <flow-create-form> (Lit) which owns the definition fetch, the
// schema form, and the createFlow submit. On success it emits hive-flow-created
// and this shell navigates to the new instance.

let { definitionId }: { definitionId: string } = $props();

let createForm = $state<FlowCreateForm | null>(null);

// Svelte must not bind props onto custom elements (the LitFlowHost pattern):
// the element's property is set imperatively.
$effect(() => {
  if (!createForm) return;
  createForm.definitionId = definitionId;
});

function handleCreated(
  event: CustomEvent<{ definitionId: string; slug: string }>
) {
  const { definitionId: id, slug } = event.detail;
  window.location.hash = `#/flows/${encodeURIComponent(id)}/${encodeURIComponent(slug)}`;
}

function handleCancel() {
  window.location.hash = `#/flows/${encodeURIComponent(definitionId)}`;
}
</script>

<div class="instantiate">
  <div class="breadcrumb">
    <a href="#/flows">flows</a>
    <span class="crumb-sep">/</span>
    <a href={`#/flows/${encodeURIComponent(definitionId)}`}>{definitionId}</a>
    <span class="crumb-sep">/</span>
    <span class="crumb-current">new instance</span>
  </div>

  <h1>new instance</h1>

  <flow-create-form
    bind:this={createForm}
    onhive-flow-created={handleCreated}
    onhive-flow-cancel={handleCancel}
  ></flow-create-form>
</div>

<style>
.instantiate {
  max-width: 520px;
  margin: 0 auto;
  padding: 2rem 1.25rem;
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: var(--text-xs);
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
</style>
