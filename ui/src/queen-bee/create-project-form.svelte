<script lang="ts">
import { jellyDisabled } from "../shared/jelly-disabled.svelte";

let { onCreateProject, onError, onCancel }: Props = $props();

type Props = {
  onCreateProject: () => void;
  onError: (err: string) => void;
  onCancel: () => void;
};

let repoPath = $state("");
let projectName = $state("");
let submitting = $state(false);

async function submit() {
  const path = repoPath.trim();
  if (!path) {
    onError("Repository path is required");
    return;
  }

  submitting = true;
  try {
    const body: Record<string, string> = { path };
    if (projectName.trim()) {
      body.name = projectName.trim();
    }

    const res = await fetch("/api/queen-bee/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      throw new Error(data.error ?? "Failed to create project");
    }

    onCreateProject();
  } catch (err) {
    onError(err instanceof Error ? err.message : "Unknown error");
  } finally {
    submitting = false;
  }
}
</script>

<div class="form">
  <h2>Link a Repository</h2>

  <label class="field">
    <span class="label">Repository path</span>
    <jelly-input
      size="small"
      value={repoPath}
      oninput={(e: Event) => repoPath = (e.target as HTMLInputElement).value}
      placeholder="/path/to/git/repo"
      use:jellyDisabled={submitting}
    ></jelly-input>
  </label>

  <label class="field">
    <span class="label">Project name (optional)</span>
    <jelly-input
      size="small"
      value={projectName}
      oninput={(e: Event) => projectName = (e.target as HTMLInputElement).value}
      placeholder="Defaults to directory name"
      use:jellyDisabled={submitting}
    ></jelly-input>
  </label>

  <div class="actions">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <jelly-button
      size="small"
      variant="mint"
      onclick={submit}
      use:jellyDisabled={submitting || !repoPath.trim()}
    >
      {submitting ? "Creating..." : "Create Project"}
    </jelly-button>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <jelly-button
      size="small"
      variant="platinum"
      onclick={onCancel}
      use:jellyDisabled={submitting}
    >
      Cancel
    </jelly-button>
  </div>
</div>

<style>
.form {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1.25rem;
  margin-bottom: 1.5rem;
}

h2 {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text);
  margin: 0 0 1rem 0;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  margin-bottom: 1rem;
}

.label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
</style>
