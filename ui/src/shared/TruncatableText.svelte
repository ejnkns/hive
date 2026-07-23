<script lang="ts">
let {
  text = "",
  maxLength = 300,
  maxLines = 3,
}: {
  text: string;
  maxLength?: number;
  maxLines?: number;
} = $props();

let expanded = $state(false);

const charLimitFromLines = $derived(
  maxLines != null
    ? text.split("\n").slice(0, maxLines).join("\n").length
    : Infinity
);
const effectiveLimit = $derived(Math.min(maxLength, charLimitFromLines));
const truncated = $derived(!expanded && text.length > effectiveLimit);
const displayText = $derived(
  truncated ? `${text.slice(0, effectiveLimit)}\u2026` : text
);
</script>

<div class="truncatable">
  <pre class="text">{displayText}</pre>
  {#if text.length > effectiveLimit}
    <button
      type="button"
      class="toggle-btn"
      onclick={() => (expanded = !expanded)}
    >
      {expanded ? "show less" : "show more"}
    </button>
  {/if}
</div>

<style>
.truncatable {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.text {
  margin: 0;
  font-family: monospace;
  font-size: 0.625rem;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.4;
}
.toggle-btn {
  background: none;
  border: 1px solid var(--border);
  color: var(--muted);
  font-family: monospace;
  font-size: 0.5625rem;
  cursor: pointer;
  padding: 0.0625rem 0.375rem;
  text-transform: uppercase;
  align-self: flex-start;
}
.toggle-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
</style>
