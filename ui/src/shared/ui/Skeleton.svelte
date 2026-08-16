<script lang="ts">
let {
  shape = "line",
  style = "",
}: {
  shape?: "line" | "rect";
  style?: string;
} = $props();
</script>

<div class="skeleton skeleton-{shape}" {style} aria-hidden="true"></div>

<style>
.skeleton {
  background: var(--surface);
  border-radius: var(--radius-sm);
  position: relative;
  overflow: hidden;
}
.skeleton::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--border) 60%, transparent),
    transparent
  );
  animation: skeleton-shimmer 1.6s var(--ease-in-out) infinite;
}

.skeleton-line {
  height: 12px;
  min-width: 60px;
}

.skeleton-rect {
  width: 100%;
  aspect-ratio: 16 / 9;
}

@keyframes skeleton-shimmer {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(100%);
  }
}
</style>
