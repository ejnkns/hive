<script lang="ts">
let {
  value = $bindable(""),
  placeholder = "",
  disabled = false,
  size = "small",
  rows,
  restProps = {} as Record<string, unknown>,
}: {
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  size?: "small" | "default";
  rows?: number;
  restProps?: Record<string, unknown>;
} = $props();
</script>

<textarea
  class="textarea textarea-{size}"
  bind:value
  {placeholder}
  {disabled}
  {rows}
  {...restProps}
></textarea>

<style>
.textarea {
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  outline: none;
  resize: vertical;
  width: 100%;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}
.textarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(var(--accent-rgb), 0.15);
}
.textarea[disabled] {
  opacity: 0.4;
  cursor: not-allowed;
  pointer-events: none;
}

.textarea-small {
  min-height: 45px;
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-xs);
}

.textarea-default {
  min-height: 72px;
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
}
</style>
