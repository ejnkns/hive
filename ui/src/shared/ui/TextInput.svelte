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
  border-radius: 4px;
  font-family: monospace;
  outline: none;
  width: 100%;
}
.text-input:focus {
  border-color: var(--accent);
}
.text-input[disabled] {
  opacity: 0.3;
  pointer-events: none;
}

.text-input-small {
  height: 28px;
  padding: 0 8px;
  font-size: 0.6875rem;
}

.text-input-default {
  height: 36px;
  padding: 0 12px;
  font-size: 0.8125rem;
}
</style>
