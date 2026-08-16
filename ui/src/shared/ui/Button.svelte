<script lang="ts">
import { Button as BitsButton } from "bits-ui";
import type { Snippet } from "svelte";

let {
  variant = "neutral",
  size = "small",
  block = false,
  disabled = false,
  class: className = "",
  children,
  ...rootProps
}: {
  variant?: "accent" | "success" | "danger" | "neutral" | "row";
  size?: "small" | "default" | "icon";
  block?: boolean;
  disabled?: boolean;
  class?: string;
  children?: Snippet;
  [key: string]: unknown;
} = $props();
</script>

<BitsButton.Root
  {...rootProps}
  {disabled}
  class="hive-btn hive-btn-{variant} hive-btn-{size} {block ? 'hive-btn-block' : ''} {className}"
>
  {@render children?.()}
</BitsButton.Root>

<style>
/* Marker buttons: a background that is always visible, colored text, square.
   Hover sweeps the marker — background fills to solid and the text flips.
   One marker per button: background, never underline. */
:global(.hive-btn) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 0;
  cursor: pointer;
  font-family: var(--font-mono);
  font-weight: 600;
  white-space: nowrap;
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out),
    opacity var(--dur-fast) var(--ease-out);
}
:global(.hive-btn:active:not([disabled])) {
  opacity: 0.7;
}
:global(.hive-btn[disabled]) {
  opacity: 0.4;
  cursor: not-allowed;
  pointer-events: none;
}

:global(.hive-btn-small) {
  min-height: 24px;
  padding: 0 8px;
  gap: 2px;
  font-size: var(--text-xs);
}

:global(.hive-btn-default) {
  min-height: 32px;
  padding: 0 14px;
  gap: 4px;
  font-size: var(--text-sm);
}

/* icon — square add-button */
:global(.hive-btn-icon) {
  width: 24px;
  min-width: 24px;
  min-height: 24px;
  padding: 0;
  font-size: var(--text-md);
  font-weight: 700;
  line-height: 1;
}

:global(.hive-btn-block) {
  width: 100%;
}

/* neutral — faint tint, dim text */
:global(.hive-btn-neutral) {
  background: rgba(var(--border-rgb), 0.35);
  color: var(--muted);
}
:global(.hive-btn-neutral:hover:not([disabled])) {
  background: var(--border);
  color: var(--text);
}

/* accent — the primary marker: gold tint behind readable text, hover sweeps
   the background to solid gold */
:global(.hive-btn-accent) {
  background: rgba(var(--accent-rgb), 0.18);
  color: var(--text);
}
:global(.hive-btn-accent:hover:not([disabled])) {
  background: var(--accent);
  color: var(--on-accent);
}

/* success */
:global(.hive-btn-success) {
  background: rgba(var(--success-rgb), 0.18);
  color: var(--success);
}
:global(.hive-btn-success:hover:not([disabled])) {
  background: var(--success);
  color: var(--bg);
}

/* danger */
:global(.hive-btn-danger) {
  background: rgba(var(--error-rgb), 0.18);
  color: var(--error);
}
:global(.hive-btn-danger:hover:not([disabled])) {
  background: var(--error);
  color: var(--bg);
}

/* row — disclosure header: full width, title left, chevron right */
:global(.hive-btn-row) {
  width: 100%;
  justify-content: space-between;
  text-align: left;
  background: none;
  color: var(--muted);
  font-weight: 700;
  text-decoration: none;
  padding: 0.25rem 0;
}
:global(.hive-btn-row:hover:not([disabled])) {
  background: none;
  color: var(--text);
}
</style>
