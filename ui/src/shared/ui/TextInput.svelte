<script lang="ts">
let {
  value = $bindable(""),
  placeholder = "",
  disabled = false,
  size = "small",
  restProps = {} as Record<string, unknown>,
}: {
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  size?: "small" | "default";
  restProps?: Record<string, unknown>;
} = $props();
</script>

<input
  type="text"
  class="text-input text-input-{size}"
  bind:value
  {placeholder}
  {disabled}
  {...restProps}
>

<style>
.text-input {
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  outline: none;
  width: 100%;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}
.text-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(var(--accent-rgb), 0.15);
}
.text-input[disabled] {
  opacity: 0.4;
  cursor: not-allowed;
  pointer-events: none;
}

.text-input-small {
  height: 32px;
  padding: 0 var(--space-2);
  font-size: var(--text-xs);
}

.text-input-default {
  height: 36px;
  padding: 0 var(--space-3);
  font-size: var(--text-sm);
}
</style>
