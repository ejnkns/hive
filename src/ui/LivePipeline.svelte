<script lang="ts">
import type { FlowEvent, ProviderData } from "./types";

let { events = [] as FlowEvent[], providers = [] as ProviderData[] } = $props();

const PADDING_TOP = 32;
const ROW_HEIGHT = 36;
const INGRESS_X = 50;
const PROVIDER_X = 740;
const SVG_WIDTH = 800;
const SESSION_TTL_MS = 30_000;

type PipelineSession = {
  requestId: string;
  phase:
    | "scoring"
    | "dispatched"
    | "thinking"
    | "streaming"
    | "complete"
    | "failed";
  provider: string | null;
  model: string | null;
  affinity: boolean;
  timestamp: number;
};

const sessions = $derived.by(() => {
  const map = new Map<string, PipelineSession>();
  const now = Date.now();

  for (const event of events) {
    const evtTs = "timestamp" in event ? event.timestamp : now;
    if (now - evtTs > SESSION_TTL_MS) continue;

    let session = map.get(event.requestId);
    if (!session) {
      session = {
        requestId: event.requestId,
        phase: "scoring",
        provider: null,
        model: null,
        affinity: false,
        timestamp: evtTs,
      };
    }

    switch (event.type) {
      case "request_received":
        session.timestamp = event.timestamp;
        break;
      case "selection_round":
        session.affinity = event.candidates.some((c) => c.affinity);
        break;
      case "node_dispatched":
        session.provider = event.provider;
        session.model = event.model;
        session.phase = "dispatched";
        break;
      case "thinking_started":
        session.phase = "thinking";
        break;
      case "streaming_started":
        session.phase = "streaming";
        break;
      case "response_complete":
        session.phase = event.success ? "complete" : "failed";
        break;
    }

    map.set(event.requestId, session);
  }

  return Array.from(map.values())
    .filter((s) => now - s.timestamp <= SESSION_TTL_MS)
    .sort((a, b) => b.timestamp - a.timestamp);
});

const svgHeight = $derived(
  Math.max(PADDING_TOP + providers.length * ROW_HEIGHT + 16, 120)
);

const ingressY = $derived(PADDING_TOP + (providers.length * ROW_HEIGHT) / 2);

function getProviderIndex(provider: string, model: string): number {
  return providers.findIndex((p) => p.name === provider && p.model === model);
}

function getProviderY(index: number): number {
  return PADDING_TOP + index * ROW_HEIGHT + ROW_HEIGHT / 2;
}

function getCooldownSec(name: string, model: string): number {
  const p = providers.find((x) => x.name === name && x.model === model);
  if (!p || p.trippedUntil == null) return 0;
  return Math.max(0, Math.round((p.trippedUntil - Date.now()) / 1000));
}

function getPathClass(session: PipelineSession): string {
  if (session.phase === "complete" || session.phase === "failed") {
    return session.phase === "failed" ? "path-failed" : "path-done";
  }
  return `path-active path-${session.phase}`;
}
</script>

<svg viewBox="0 0 {SVG_WIDTH} {svgHeight}" class="pipeline">
  {#each providers as p, i}
    {@const y = getProviderY(i)}
    {@const cd = getCooldownSec(p.name, p.model)}
    <g class="provider-node" transform="translate({PROVIDER_X}, {y})">
      <circle
        r="4"
        class={cd > 0 ? "cooldown" : p.keyConfigured ? "active" : "inactive"}
      />
      <text x="12" y="4" class="provider-label">{p.displayName}:{p.model}</text>
      {#if cd > 0}
        <text x="12" y="16" class="cooldown-label">{String(cd)}s</text>
      {/if}
    </g>
  {/each}

  <circle cx={INGRESS_X} cy={ingressY} r="7" class="ingress" />
  <text x={INGRESS_X + 14} y={ingressY + 4} class="ingress-label">hive</text>

  {#if sessions.length === 0}
    <text
      x={SVG_WIDTH / 2}
      y={svgHeight / 2}
      text-anchor="middle"
      class="no-data"
    >
      awaiting requests...
    </text>
  {/if}

  {#each sessions as session}
    {@const pidx = getProviderIndex(
      session.provider ?? "",
      session.model ?? "",
    )}
    {#if pidx >= 0}
      {@const targetY = getProviderY(pidx)}
      {@const isDone =
        session.phase === "complete" || session.phase === "failed"}
      {@const opacity = isDone ? 0.2 : Math.max(0.5, 1 - (Date.now() - session.timestamp) / 15000 * 0.5)}

      <path
        d="M {INGRESS_X},{ingressY} C {INGRESS_X + 140},{ingressY} {PROVIDER_X - 140},{targetY} {PROVIDER_X},{targetY}"
        class={getPathClass(session)}
        style="opacity:{opacity.toFixed(2)}"
      />

      {#if !isDone && session.affinity}
        <polygon
          points="{INGRESS_X - 8},{ingressY - 4} {INGRESS_X - 2},{ingressY} {INGRESS_X - 8},{ingressY + 4}"
          fill="var(--accent)"
        />
      {/if}
    {/if}
  {/each}
</svg>

<style>
  .pipeline {
    width: 100%;
    display: block;
    background: var(--card);
    border: 1px solid var(--border);
    overflow: hidden;
  }

  .no-data {
    fill: var(--muted);
    font-size: 0.625rem;
  }

  .ingress {
    fill: var(--accent);
  }

  .ingress-label {
    fill: var(--muted);
    font-size: 0.5625rem;
    font-family: monospace;
  }

  .provider-node circle.active {
    fill: var(--success);
  }

  .provider-node circle.inactive {
    fill: var(--border);
  }

  .provider-node circle.cooldown {
    fill: var(--error);
  }

  .provider-label {
    fill: var(--muted);
    font-size: 0.5rem;
    font-family: monospace;
    dominant-baseline: middle;
  }

  .cooldown-label {
    fill: var(--error);
    font-size: 0.5rem;
    font-family: monospace;
    dominant-baseline: middle;
  }

  path {
    fill: none;
    stroke-width: 1.5;
    stroke-linecap: round;
    transition: stroke 300ms ease, opacity 500ms ease;
  }

  .path-active.path-scoring {
    stroke: var(--accent);
    stroke-dasharray: 4 4;
    animation: dash-pulse 1.5s ease-in-out infinite;
  }

  .path-active.path-dispatched {
    stroke: var(--muted);
    stroke-dasharray: 2 2;
  }

  .path-active.path-thinking {
    stroke: #e2a93b;
    stroke-dasharray: 6 3;
    animation: dash-slide 1s linear infinite;
  }

  .path-active.path-streaming {
    stroke: var(--success);
    stroke-dasharray: 3 2;
    animation: dash-flow 0.4s linear infinite;
  }

  .path-done {
    stroke: var(--success);
    stroke-dasharray: none;
  }

  .path-failed {
    stroke: var(--error);
    opacity: 0.25;
  }

  @keyframes dash-pulse {
    0%,
    100% {
      opacity: 0.4;
    }
    50% {
      opacity: 1;
    }
  }

  @keyframes dash-slide {
    to {
      stroke-dashoffset: -18;
    }
  }

  @keyframes dash-flow {
    to {
      stroke-dashoffset: -10;
    }
  }
</style>
