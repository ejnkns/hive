<script lang="ts">
import type { FlowEvent, ProviderData } from "./types";

let { events = [] as FlowEvent[], providers = [] as ProviderData[] } = $props();

const PADDING_TOP = 32;
const ROW_HEIGHT = 32;
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

type PipelineRow =
  | { kind: "provider"; displayName: string; provider: string }
  | {
      kind: "model";
      provider: string;
      displayName: string;
      model: string;
      cooldownSec: number;
      keyConfigured: boolean;
    };

function getCooldownSec(name: string, model: string): number {
  const p = providers.find((x) => x.name === name && x.model === model);
  if (!p || p.trippedUntil == null) return 0;
  return Math.max(0, Math.round((p.trippedUntil - Date.now()) / 1000));
}

const rows = $derived.by(() => {
  const seen = new Set<string>();
  const providerMap = new Map<
    string,
    {
      displayName: string;
      models: {
        provider: string;
        model: string;
        cooldownSec: number;
        keyConfigured: boolean;
      }[];
    }
  >();

  for (const session of sessions) {
    if (!session.provider || !session.model) continue;
    const key = `${session.provider}:${session.model}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const p = providers.find(
      (x) => x.name === session.provider && x.model === session.model
    );

    if (!providerMap.has(session.provider)) {
      providerMap.set(session.provider, {
        displayName: p?.displayName ?? session.provider,
        models: [],
      });
    }

    const group = providerMap.get(session.provider);
    if (group) {
      group.models.push({
        provider: session.provider,
        model: session.model,
        cooldownSec: getCooldownSec(session.provider, session.model),
        keyConfigured: p?.keyConfigured ?? false,
      });
    }
  }

  const result: PipelineRow[] = [];
  for (const [provider, group] of providerMap) {
    result.push({
      kind: "provider",
      displayName: group.displayName,
      provider,
    });
    for (const model of group.models) {
      result.push({
        kind: "model",
        provider: model.provider,
        displayName: group.displayName,
        model: model.model,
        cooldownSec: model.cooldownSec,
        keyConfigured: model.keyConfigured,
      });
    }
  }

  return result;
});

const svgHeight = $derived(
  Math.max(PADDING_TOP + rows.length * ROW_HEIGHT + 16, 120)
);

const ingressY = $derived(PADDING_TOP + (rows.length * ROW_HEIGHT) / 2);

function getRowY(index: number): number {
  return PADDING_TOP + index * ROW_HEIGHT + ROW_HEIGHT / 2;
}

function getTargetRowIndex(provider: string, model: string): number {
  return rows.findIndex(
    (r) => r.kind === "model" && r.provider === provider && r.model === model
  );
}

function getPathClass(session: PipelineSession): string {
  if (session.phase === "complete" || session.phase === "failed") {
    return session.phase === "failed" ? "path-failed" : "path-done";
  }
  return `path-active path-${session.phase}`;
}
</script>

<svg viewBox="0 0 {SVG_WIDTH} {svgHeight}" class="pipeline">
  {#each rows as row, i}
    {@const y = getRowY(i)}
    {#if row.kind === "provider"}
      <text
        x={PROVIDER_X + 4}
        y={y + 4}
        class="provider-header"
      >
        {row.displayName}
      </text>
    {:else}
      <g class="model-node" transform="translate({PROVIDER_X}, {y})">
        <circle
          r="3"
          class={row.cooldownSec > 0 ? "cooldown" : row.keyConfigured ? "active" : "inactive"}
        />
        <text x="12" y="4" class="model-label">{row.model}</text>
        {#if row.cooldownSec > 0}
          <text x="12" y="16" class="cooldown-label">{String(row.cooldownSec)}s</text>
        {/if}
      </g>
    {/if}
  {/each}

  <circle cx={INGRESS_X} cy={ingressY} r="7" class="ingress" />
  <text x={INGRESS_X + 14} y={ingressY + 4} class="ingress-label">hive</text>

  {#if rows.length === 0}
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
    {@const ridx = getTargetRowIndex(
      session.provider ?? "",
      session.model ?? "",
    )}
    {#if ridx >= 0}
      {@const targetY = getRowY(ridx)}
      {@const isDone =
        session.phase === "complete" || session.phase === "failed"}
      {@const opacity = isDone
        ? 0.2
        : Math.max(0.5, 1 - (Date.now() - session.timestamp) / 15000 * 0.5)}

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

  .provider-header {
    fill: var(--muted);
    font-size: 0.5rem;
    font-family: monospace;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    dominant-baseline: middle;
  }

  .model-node circle.active {
    fill: var(--success);
  }

  .model-node circle.inactive {
    fill: var(--border);
  }

  .model-node circle.cooldown {
    fill: var(--error);
  }

  .model-label {
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
