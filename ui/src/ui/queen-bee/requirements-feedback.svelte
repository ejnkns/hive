<script lang="ts">
import type { RequirementsFeedback } from "shared/board-types";
import { isRecord } from "../check-record";

let { projectId, feedback, onRepairStarted }: Props = $props();

type Props = {
  projectId: string;
  feedback: RequirementsFeedback;
  onRepairStarted: () => void;
};

let busy = $state(false);
let error = $state<string | null>(null);

async function startRepair() {
  busy = true;
  error = null;
  try {
    const response = await fetch(
      `/api/queen-bee/${projectId}/requirements-feedback/${feedback.id}/repair/start`,
      { method: "POST" }
    );
    const value: unknown = await response.json();
    if (!response.ok) {
      throw new Error(
        isRecord(value) && typeof value.error === "string"
          ? value.error
          : "Could not start Requirements Repair"
      );
    }
    onRepairStarted();
  } catch (caught) {
    error =
      caught instanceof Error
        ? caught.message
        : "Could not start Requirements Repair";
  } finally {
    busy = false;
  }
}
</script>

<section class="feedback">
  <header>
    <div>
      <h2>Requirements need another decision</h2>
      <p>The Planner Agent stopped before creating a partial or unreliable plan.</p>
    </div>
    <button class="btn primary" onclick={startRepair} disabled={busy}>
      {busy ? "Starting…" : "Repair requirements"}
    </button>
  </header>

  {#if error}<div class="error">{error}</div>{/if}

  {#each feedback.issues as issue}
    <article>
      <div class="issue-heading">
        <strong>{issue.category.replaceAll("_", " ")}</strong>
        <span>{issue.requirementRefs.join(", ") || "Project-wide"}</span>
      </div>
      <p>{issue.explanation}</p>
      <dl>
        <dt>Decision needed</dt><dd>{issue.decisionNeeded}</dd>
        <dt>Recommendation</dt><dd>{issue.recommendation}</dd>
        {#if issue.evidence.length > 0}
          <dt>Evidence</dt><dd>{issue.evidence.join(" · ")}</dd>
        {/if}
      </dl>
    </article>
  {/each}
</section>

<style>
  .feedback { display: flex; flex-direction: column; gap: 0.75rem; }
  header, .issue-heading { align-items: center; display: flex; justify-content: space-between; gap: 1rem; }
  h2 { color: var(--text); font-size: 1rem; margin: 0; }
  p, dt, dd, span { color: var(--muted); font-size: 0.75rem; }
  p { margin: 0.25rem 0 0; }
  article { background: var(--card); border: 1px solid var(--border); border-radius: 7px; padding: 0.75rem; }
  strong { color: var(--text); font-size: 0.75rem; text-transform: capitalize; }
  dl { display: grid; grid-template-columns: 8rem 1fr; gap: 0.25rem 0.5rem; margin: 0.625rem 0 0; }
  dt { font-weight: 600; }
  dd { margin: 0; }
  .btn { border: 1px solid var(--border); border-radius: 5px; cursor: pointer; font-size: 0.6875rem; padding: 0.375rem 0.625rem; }
  .primary { background: var(--accent); border-color: var(--accent); color: #1b1601; }
  .btn:disabled { cursor: default; opacity: 0.5; }
  .error { color: #dc3c3c; font-size: 0.75rem; }
</style>
