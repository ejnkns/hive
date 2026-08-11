<script lang="ts">
import type { FlowStatus } from "../flow-api.ts";

let { status }: { status: FlowStatus } = $props();
</script>

<span class="status-dot status-{status}" role="img" aria-label={status}></span>

<style>
.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-error {
  background: var(--error);
}

.status-running {
  background: var(--accent);
}

.status-waiting {
  background: var(--warning);
}

.status-idle {
  background: var(--muted);
}

.status-complete {
  background: var(--success);
}
</style>
