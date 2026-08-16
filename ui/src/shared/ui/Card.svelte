<script lang="ts">
let { children }: { children?: import("svelte").Snippet } = $props();
</script>

<div class="card">
  {@render children?.()}
</div>

<style>
.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 0.75rem;
}
</style>
