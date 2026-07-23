<script lang="ts">
import type { ProjectListItem } from "shared/project-types";
import CreateProjectForm from "./create-project-form.svelte";

let projects: ProjectListItem[] = $state([]);
let loading = $state(true);
let error = $state<string | null>(null);
let showCreateForm = $state(false);

async function loadProjects() {
  loading = true;
  error = null;
  try {
    const res = await fetch("/api/queen-bee/projects");
    if (!res.ok) throw new Error("Failed to load projects");
    const data = (await res.json()) as { projects: ProjectListItem[] };
    projects = data.projects;
  } catch (err) {
    error = err instanceof Error ? err.message : "Unknown error";
  } finally {
    loading = false;
  }
}

async function unlinkProject(id: string) {
  try {
    const res = await fetch(`/api/queen-bee/projects/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("Failed to unlink project");
    await loadProjects();
  } catch (err) {
    error = err instanceof Error ? err.message : "Unknown error";
  }
}

async function onCreateProject() {
  showCreateForm = false;
  await loadProjects();
}

function onError(err: string) {
  error = err;
  showCreateForm = false;
}

loadProjects();
</script>

<div class="project-overview">
  <div class="header">
    <h1>Projects</h1>
    <button
      type="button"
      class="btn btn-primary"
      onclick={() => (showCreateForm = true)}
    >
      New Project
    </button>
  </div>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if showCreateForm}
    <CreateProjectForm
      {onCreateProject}
      {onError}
      onCancel={() => (showCreateForm = false)}
    />
  {/if}

  {#if loading}
    <div class="loading">Loading projects...</div>
  {:else if projects.length === 0}
    <div class="empty">
      <p>No projects yet.</p>
      <p>Link a git repo to get started.</p>
    </div>
  {:else}
    <div class="project-list">
      {#each projects as project (project.id)}
        <div class="project-card">
          <div class="project-info">
            <div class="project-name">{project.name}</div>
            <div class="project-path">{project.repoPath}</div>
          </div>
          <div class="project-actions">
            <a class="btn btn-outline" href={`#/project/${project.id}`}>
              Open
            </a>
            <button
              type="button"
              class="btn btn-danger"
              onclick={() => unlinkProject(project.id)}
            >
              Unlink
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
.project-overview {
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem 1.25rem;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.5rem;
}

h1 {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text);
  margin: 0;
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

.btn:hover {
  background: var(--border);
}

.btn-primary {
  background: var(--accent);
  color: #1b1601;
  border-color: var(--accent);
}

.btn-primary:hover {
  background: rgba(var(--accent-rgb), 0.85);
}

.btn-outline {
  background: transparent;
}

.btn-danger {
  background: transparent;
  border-color: rgba(220, 60, 60, 0.3);
  color: #dc3c3c;
}

.btn-danger:hover {
  background: rgba(220, 60, 60, 0.1);
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

.loading {
  font-size: 0.875rem;
  color: var(--muted);
  padding: 2rem 0;
  text-align: center;
}

.empty {
  text-align: center;
  padding: 3rem 1rem;
  color: var(--muted);
  font-size: 0.875rem;
}

.empty p {
  margin: 0.25rem 0;
}

.project-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.project-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem 1.25rem;
}

.project-info {
  min-width: 0;
  flex: 1;
}

.project-name {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text);
}

.project-path {
  font-size: 0.75rem;
  color: var(--muted);
  margin-top: 0.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
  margin-left: 1rem;
}
</style>
