<script lang="ts">
type Variant = "success" | "danger" | "warning" | "neutral";

let {
  variant = "neutral",
  size = "small",
  outline = false,
  live = false,
  children,
}: {
  variant?: Variant;
  size?: "small" | "default";
  outline?: boolean;
  live?: boolean;
  children?: import("svelte").Snippet;
} = $props();
</script>

<span
  class="badge badge-{variant} badge-{size}"
  class:badge-outline={outline}
  class:badge-live={live}
>
  <span class="sr-only">{live ? "Live status: " : ""}</span>
  {@render children?.()}
</span>

<style>
.badge {
  display: inline-flex;
  align-items: center;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-weight: 600;
  white-space: nowrap;
}

.badge-small {
  height: 18px;
  padding: 0 4px;
  font-size: 0.5625rem;
}

.badge-default {
  height: 22px;
  padding: 0 6px;
  font-size: var(--text-xs);
}

.badge-outline {
  background: transparent;
}

.badge-success {
  background: var(--success);
  color: var(--bg);
}
.badge-success.badge-outline {
  background: transparent;
  color: var(--success);
  border: 1px solid var(--success);
}

.badge-danger {
  background: var(--error);
  color: var(--bg);
}
.badge-danger.badge-outline {
  background: transparent;
  color: var(--error);
  border: 1px solid var(--error);
}

.badge-warning {
  background: var(--warning);
  color: var(--bg);
}
.badge-warning.badge-outline {
  background: transparent;
  color: var(--warning);
  border: 1px solid var(--warning);
}

.badge-neutral {
  background: var(--surface);
  color: var(--text);
}
.badge-neutral.badge-outline {
  background: transparent;
  color: var(--muted);
  border: 1px solid var(--border);
}

/* subdued pulse — the hive is alive, not alarmed */
.badge-live {
  position: relative;
}
.badge-live::before {
  content: "";
  display: inline-block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  margin-right: 3px;
  background: currentColor;
  animation: live-pulse 2s var(--ease-in-out) infinite;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  clip: rect(1px, 1px, 1px, 1px);
  white-space: nowrap;
  overflow: hidden;
}

@keyframes live-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.6;
  }
}
</style>
