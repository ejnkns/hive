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
  border-radius: 4px;
  animation: skeleton-pulse 2s ease-in-out infinite;
}

.skeleton-line {
  height: 12px;
  min-width: 60px;
}

.skeleton-rect {
  width: 100%;
  aspect-ratio: 16 / 9;
}

@keyframes skeleton-pulse {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 0.7;
  }
}
</style>
