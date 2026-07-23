<script lang="ts">
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
    <input
      type="text"
      bind:value={repoPath}
      placeholder="/path/to/git/repo"
      disabled={submitting}
    >
  </label>

  <label class="field">
    <span class="label">Project name (optional)</span>
    <input
      type="text"
      bind:value={projectName}
      placeholder="Defaults to directory name"
      disabled={submitting}
    >
  </label>

  <div class="actions">
    <button
      type="button"
      class="btn btn-primary"
      onclick={submit}
      disabled={submitting || !repoPath.trim()}
    >
      {submitting ? "Creating..." : "Create Project"}
    </button>
    <button
      type="button"
      class="btn btn-outline"
      onclick={onCancel}
      disabled={submitting}
    >
      Cancel
    </button>
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

input {
  padding: 0.5rem 0.75rem;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 0.875rem;
  font-family: inherit;
}

input:focus {
  outline: none;
  border-color: var(--accent);
}

input:disabled {
  opacity: 0.5;
}

.actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.btn {
  padding: 0.5rem 1rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  background: var(--surface);
  color: var(--text);
  transition: background 0.15s;
}

.btn:hover:not(:disabled) {
  background: var(--border);
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.btn-primary {
  background: var(--accent);
  color: #1b1601;
  border-color: var(--accent);
}

.btn-primary:hover:not(:disabled) {
  background: rgba(var(--accent-rgb), 0.85);
}

.btn-outline {
  background: transparent;
}
</style>
