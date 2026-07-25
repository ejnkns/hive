<script lang="ts">
import { Button as BitsButton } from "bits-ui";
import type { Snippet } from "svelte";

type Variant = "mint" | "rose" | "platinum" | "amber" | "azure";

let {
  variant = "platinum",
  size = "small",
  block = false,
  disabled = false,
  children,
  ...rootProps
}: {
  variant?: Variant;
  size?: "small" | "default";
  block?: boolean;
  disabled?: boolean;
  children?: Snippet;
  [key: string]: unknown;
} = $props();
</script>

<BitsButton.Root
  {...rootProps}
  {disabled}
  class="hive-btn hive-btn-{variant} hive-btn-{size} {block ? 'hive-btn-block' : ''}"
>
  {@render children?.()}
</BitsButton.Root>

<style>
:global(.hive-btn) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  font-family: monospace;
  font-weight: 600;
  transition: opacity 0.15s, background 0.15s;
  white-space: nowrap;
}
:global(.hive-btn:active) {
  opacity: 0.8;
}
:global(.hive-btn[disabled]) {
  opacity: 0.3;
  pointer-events: none;
}

:global(.hive-btn-small) {
  height: 28px;
  padding: 0 8px;
  font-size: 0.6875rem;
  gap: 4px;
}

:global(.hive-btn-default) {
  height: 36px;
  padding: 0 16px;
  font-size: 0.8125rem;
  gap: 6px;
}

:global(.hive-btn-block) {
  width: 100%;
}

:global(.hive-btn-mint) {
  background: var(--success);
  color: var(--bg);
  border-color: var(--success);
}
:global(.hive-btn-mint:hover) {
  background: color-mix(in srgb, var(--success) 85%, white);
}

:global(.hive-btn-rose) {
  background: var(--error);
  color: white;
  border-color: var(--error);
}
:global(.hive-btn-rose:hover) {
  background: color-mix(in srgb, var(--error) 85%, white);
}

:global(.hive-btn-platinum) {
  background: var(--surface);
  color: var(--text);
  border-color: var(--border);
}
:global(.hive-btn-platinum:hover) {
  background: var(--border);
}

:global(.hive-btn-amber) {
  background: var(--warning);
  color: var(--bg);
  border-color: var(--warning);
}

:global(.hive-btn-azure) {
  background: var(--accent);
  color: var(--bg);
  border-color: var(--accent);
}
:global(.hive-btn-azure:hover) {
  background: color-mix(in srgb, var(--accent) 85%, white);
}
</style>
