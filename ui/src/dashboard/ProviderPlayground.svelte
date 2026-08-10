<script lang="ts">
import type { AvailableProvider } from "shared/dashboard-types";
import Button from "../shared/ui/Button.svelte";
import Select from "../shared/ui/Select.svelte";
import Textarea from "../shared/ui/Textarea.svelte";
import { runProviderTest } from "./provider-playground/run-provider-test";

let { providers }: { providers: AvailableProvider[] } = $props();

type RunStatus = "idle" | "running" | "complete" | "error" | "cancelled";

let prompt = $state("");
let providerName = $state("");
let modelName = $state("");
let responseText = $state("");
let status = $state<RunStatus>("idle");
let error = $state<string | null>(null);
let actualProvider = $state<string | null>(null);
let actualModel = $state<string | null>(null);
let elapsedMs = $state<number | null>(null);
let controller: AbortController | null = null;

let selectableProviders = $derived(
  providers.filter(
    (provider) =>
      provider.keyConfigured && !provider.disabled && provider.models.length > 0
  )
);

let selectedProvider = $derived(
  selectableProviders.find((provider) => provider.name === providerName) ?? null
);

let providerItems = $derived([
  { value: "", label: "Auto" },
  ...selectableProviders.map((p) => ({ value: p.name, label: p.displayName })),
]);

let modelItems = $derived(
  (selectedProvider?.models ?? []).map((m) => ({ value: m, label: m }))
);

$effect(() => {
  if (!providerName) {
    modelName = "";
    return;
  }
  if (!selectedProvider) {
    providerName = "";
    modelName = "";
    return;
  }
  if (!selectedProvider.models.includes(modelName)) {
    modelName = selectedProvider.models[0] ?? "";
  }
});

async function runPrompt() {
  const submittedPrompt = prompt.trim();
  if (!submittedPrompt || status === "running") return;

  status = "running";
  error = null;
  responseText = "";
  actualProvider = null;
  actualModel = null;
  elapsedMs = null;
  controller = new AbortController();
  const startedAt = performance.now();

  try {
    await runProviderTest({
      prompt: submittedPrompt,
      route: providerName && modelName ? { providerName, modelName } : null,
      signal: controller.signal,
      onRoute: (route) => {
        actualProvider = route.providerName;
        actualModel = route.modelName;
      },
      onDelta: (content) => {
        responseText += content;
      },
    });
    status = "complete";
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === "AbortError") {
      status = "cancelled";
    } else {
      status = "error";
      error = caught instanceof Error ? caught.message : "Provider test failed";
    }
  } finally {
    elapsedMs = Math.round(performance.now() - startedAt);
    controller = null;
  }
}

function cancelRun() {
  controller?.abort();
}

function routeLabel(): string {
  if (actualProvider && actualModel) return `${actualProvider}:${actualModel}`;
  if (providerName && modelName) return `${providerName}:${modelName}`;
  return "Auto routing";
}
</script>

<div class="panel">
  <div class="heading">
    <div>
      <div class="section-head">Provider playground</div>
      <p>Send one prompt through Hive and record the response in telemetry.</p>
    </div>
    <div class="route-controls">
      <div class="route-field">
        <span class="route-label">Route</span>
        <Select
          items={providerItems}
          bind:value={() => providerName, (v) => providerName = v}
          disabled={status === "running"}
          placeholder="Auto"
        />
      </div>
      <div class="route-field">
        <span class="route-label">Model</span>
        <Select
          items={modelItems}
          bind:value={() => modelName, (v) => modelName = v}
          placeholder={selectedProvider ? undefined : "Selected automatically"}
          disabled={status === "running" || !selectedProvider}
        />
      </div>
    </div>
  </div>

  <div class="input-row">
    <Textarea
      bind:value={prompt}
      placeholder="Enter a diagnostic prompt..."
      disabled={status === "running"}
      restProps={{
        onkeydown: (event: KeyboardEvent) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            void runPrompt();
          }
        },
      }}
    />
    {#if status === "running"}
      <Button variant="rose" onclick={cancelRun}> Cancel </Button>
    {:else}
      <Button
        variant="mint"
        onclick={() => void runPrompt()}
        disabled={!prompt.trim()}
      >
        Send
      </Button>
    {/if}
  </div>

  {#if status !== "idle"}
    <div class="status-bar" aria-live="polite">
      <span class="status-dot {status}"></span>
      <span>{status === "running" ? "Waiting for provider..." : status}</span>
      <span class="route">{routeLabel()}</span>
      {#if elapsedMs !== null}
        <span>{elapsedMs}ms</span>
      {/if}
    </div>
  {/if}

  {#if error}
    <div class="error">{error}</div>
  {/if}
  {#if responseText || status === "running"}
    <div class="response" class:streaming={status === "running"}>
      {responseText || "Response stream connected..."}
    </div>
  {/if}
</div>

<style>
.panel {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 1rem;
}
.heading {
  align-items: flex-start;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
}
.section-head {
  color: var(--text);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
p {
  color: var(--muted);
  font-size: 0.6875rem;
  margin: 0.25rem 0 0;
}
.route-controls {
  display: flex;
  gap: 0.5rem;
}
.route-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.route-label {
  color: var(--muted);
  font-size: 0.625rem;
}
.input-row {
  align-items: flex-start;
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;
}
.status-bar {
  align-items: center;
  color: var(--muted);
  display: flex;
  font-size: 0.6875rem;
  gap: 0.5rem;
  margin-top: 0.625rem;
}
.status-dot {
  background: var(--muted);
  border-radius: 50%;
  flex-shrink: 0;
  height: 6px;
  width: 6px;
}
.status-dot.running {
  animation: pulse 1s ease-in-out infinite;
  background: var(--accent);
}
.status-dot.complete {
  background: var(--success);
}
.status-dot.error {
  background: var(--error);
}
.route {
  color: var(--text);
  font-family: monospace;
}
.response {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-size: 0.8rem;
  margin-top: 0.75rem;
  max-height: 18rem;
  min-height: 3rem;
  overflow: auto;
  padding: 0.75rem;
  white-space: pre-wrap;
}
.response.streaming::after {
  animation: pulse 1s ease-in-out infinite;
  content: "|";
}
.error {
  color: var(--error);
  font-size: 0.75rem;
  margin-top: 0.75rem;
  white-space: pre-wrap;
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}
@media (max-width: 720px) {
  .heading,
  .route-controls {
    flex-direction: column;
  }
  .route-controls {
    width: 100%;
  }
}
</style>
