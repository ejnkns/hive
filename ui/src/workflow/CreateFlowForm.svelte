<script lang="ts">
import Button from "../shared/ui/Button.svelte";
import TextInput from "../shared/ui/TextInput.svelte";
import { createFlow } from "../workflow/workflow-api";

let {
  onCreateFlow,
  onError,
  onCancel,
}: {
  onCreateFlow: (flowId: string) => void;
  onError: (err: string) => void;
  onCancel: () => void;
} = $props();

let definitionId = $state("queen-bee");
let name = $state("");
let repoPath = $state("");
let submitting = $state(false);

async function submit() {
  const definition = definitionId.trim();
  if (!definition) {
    onError("Flow definition id is required");
    return;
  }
  if (!name.trim()) {
    onError("Flow name is required");
    return;
  }

  submitting = true;
  try {
    const config: Record<string, string> = { name: name.trim() };
    if (repoPath.trim()) config.repoPath = repoPath.trim();
    const { flowId } = await createFlow({ definitionId: definition, config });
    onCreateFlow(flowId);
  } catch (err) {
    onError(err instanceof Error ? err.message : "Failed to create flow");
  } finally {
    submitting = false;
  }
}
</script>

<div class="form">
  <h2>New Flow</h2>

  <label class="field">
    <span class="label">Definition</span>
    <TextInput bind:value={definitionId} disabled={submitting} />
  </label>

  <label class="field">
    <span class="label">Name</span>
    <TextInput
      bind:value={name}
      placeholder="My project"
      disabled={submitting}
    />
  </label>

  <label class="field">
    <span class="label">Repository path (optional)</span>
    <TextInput
      bind:value={repoPath}
      placeholder="/path/to/git/repo"
      disabled={submitting}
    />
    <span class="hint">Leave empty for a non-git flow.</span>
  </label>

  <div class="actions">
    <Button
      variant="mint"
      onclick={submit}
      disabled={submitting || !definitionId.trim() || !name.trim()}
    >
      {submitting ? "Creating..." : "Create Flow"}
    </Button>
    <Button variant="platinum" onclick={onCancel} disabled={submitting}>
      Cancel
    </Button>
  </div>
</div>

<style>
.form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text);
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

.hint {
  font-size: 0.6875rem;
  color: var(--muted);
}

.actions {
  display: flex;
  gap: 0.5rem;
}
</style>
