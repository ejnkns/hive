<script lang="ts">
import type { AvailableProvider } from "shared/dashboard-types";
import ProviderPlayground from "./ProviderPlayground.svelte";

let {
  providers = [] as AvailableProvider[],
}: {
  providers?: AvailableProvider[];
} = $props();
</script>

<div class="playground-page">
  <header class="page-head">
    <h1 class="page-title">playground</h1>
    <p class="page-sub">
      probe providers directly — one prompt, full stream, real telemetry.
    </p>
  </header>
  <ProviderPlayground {providers} />
</div>

<style>
.playground-page {
  max-width: 820px;
  margin: 0 auto;
  padding: var(--space-6) 1.25rem;
}

.page-head {
  margin-bottom: var(--space-4);
}

.page-title {
  font-size: var(--text-lg);
  font-weight: 700;
  margin: 0;
}

.page-sub {
  font-size: var(--text-sm);
  color: var(--muted);
  margin: 4px 0 0;
}
</style>
