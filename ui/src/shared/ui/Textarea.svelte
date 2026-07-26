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

<textarea
  class="textarea textarea-{size}"
  bind:value
  {placeholder}
  {disabled}
  {...restProps}
></textarea>

<style>
.textarea {
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-family: monospace;
  outline: none;
  resize: vertical;
  width: 100%;
}
.textarea:focus {
  border-color: var(--accent);
}
.textarea[disabled] {
  opacity: 0.3;
  pointer-events: none;
}

.textarea-small {
  min-height: 45px;
  padding: 4px 8px;
  font-size: 0.6875rem;
}

.textarea-default {
  min-height: 72px;
  padding: 8px 12px;
  font-size: 0.8125rem;
}
</style>
