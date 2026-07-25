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
  class="btn btn-{variant} btn-{size} {block ? 'btn-block' : ''}"
>
  {@render children?.()}
</BitsButton.Root>

<style>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  font-family: monospace;
  font-weight: 600;
  transition:
    opacity 0.15s,
    background 0.15s;
  white-space: nowrap;
}
.btn:active {
  opacity: 0.8;
}
.btn[disabled] {
  opacity: 0.3;
  pointer-events: none;
}

.btn-small {
  height: 28px;
  padding: 0 8px;
  font-size: 0.6875rem;
  gap: 4px;
}

.btn-default {
  height: 36px;
  padding: 0 16px;
  font-size: 0.8125rem;
  gap: 6px;
}

.btn-block {
  width: 100%;
}

.btn-mint {
  background: var(--success);
  color: var(--bg);
  border-color: var(--success);
}
.btn-mint:hover {
  background: color-mix(in srgb, var(--success) 85%, white);
}

.btn-rose {
  background: var(--error);
  color: white;
  border-color: var(--error);
}
.btn-rose:hover {
  background: color-mix(in srgb, var(--error) 85%, white);
}

.btn-platinum {
  background: var(--surface);
  color: var(--text);
  border-color: var(--border);
}
.btn-platinum:hover {
  background: var(--border);
}

.btn-amber {
  background: var(--warning);
  color: var(--bg);
  border-color: var(--warning);
}

.btn-azure {
  background: var(--accent);
  color: var(--bg);
  border-color: var(--accent);
}
.btn-azure:hover {
  background: color-mix(in srgb, var(--accent) 85%, white);
}
</style>
