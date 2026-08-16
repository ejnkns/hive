<script lang="ts">
import { comb, wordmark } from "shared/ascii-art";
import { onMount } from "svelte";
import { dashboardSocket } from "../dashboard/dashboard-socket.svelte";

type BootStage = "none" | "comb" | "wordmark" | "meta";

let boot = $state<BootStage>("none");

const combLines = comb.split("\n");
const wordmarkChars = [...wordmark];

let live = $derived.by(() => {
  const p = dashboardSocket.providers;
  const configuredNames = new Set(
    p.filter((x) => x.keyConfigured).map((x) => x.name)
  );
  const metrics = dashboardSocket.metrics;
  const total = metrics.length;
  const ok = metrics.filter((m) => m.success).length;
  const rate = total > 0 ? Math.round((ok / total) * 100) : null;
  return {
    online: dashboardSocket.connected,
    configured: configuredNames.size,
    rate,
    addr: `${dashboardSocket.serverHost}:${dashboardSocket.serverPort}`,
  };
});

let timers: ReturnType<typeof setTimeout>[] = [];

onMount(() => {
  const alreadyBooted = sessionStorage.getItem("hive-booted") === "1";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (alreadyBooted || reduced) {
    boot = "meta";
    return;
  }
  const schedule = (stage: BootStage, delay: number) =>
    timers.push(setTimeout(() => (boot = stage), delay));
  schedule("comb", 60);
  schedule("wordmark", 700);
  schedule("meta", 1150);
  timers.push(
    setTimeout(() => sessionStorage.setItem("hive-booted", "1"), 1700)
  );
  return () => timers.forEach(clearTimeout);
});
</script>

<main class="landing" aria-label="hive home">
  <div class="boot-stage" class:on={boot !== "none"}>
    {#if boot === "none" || boot === "comb" || boot === "wordmark" || boot === "meta"}
      <pre
        class="comb"
        aria-hidden="true"
      >{#each combLines as line, i (i)}<span class="comb-row" style="animation-delay:{i * 55}ms">{line}</span>
{/each}</pre>
    {/if}

    {#if boot === "wordmark" || boot === "meta"}
      <h1 class="wordmark" aria-label="hive">
        {#each wordmarkChars as ch, i (i)}
          <span class="wordmark-char" style="animation-delay:{i * 40}ms"
            >{ch}</span
          >
        {/each}
        <span class="caret"></span>
      </h1>
    {/if}

    {#if boot === "meta"}
      <p class="version">v0.1.0</p>

      <p class="status">
        <span
          class="status-dot"
          class:online={live.online}
          aria-hidden="true"
        ></span>
        {live.online ? "online" : "offline"}
        {#if live.online}
          · {live.configured} provider{live.configured !== 1 ? "s" : ""}
          {#if live.rate != null}
            · {live.rate}% ok
          {/if}
          · <span class="status-addr">{live.addr}</span>
        {/if}
      </p>
    {/if}
  </div>
</main>

<style>
.landing {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem 1.25rem;
}

.boot-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.comb {
  font-family: var(--font-mono);
  font-size: clamp(0.4375rem, 1.3vw, 0.625rem);
  line-height: 1.35;
  color: var(--brand);
  margin: 0 0 1.5rem;
  text-align: center;
  white-space: pre;
  opacity: 0;
  transition: opacity var(--dur) var(--ease-out);
}
.boot-stage.on .comb {
  opacity: 1;
}
.comb-row {
  display: inline-block;
  opacity: 0;
  animation: row-rise 240ms var(--ease-out) forwards;
}

.wordmark {
  font-family: var(--font-mono);
  font-size: var(--text-xl);
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--text);
  margin: 0;
  min-height: 1.5em;
}
.wordmark-char {
  opacity: 0;
  animation: char-in 40ms var(--ease-out) forwards;
}
.caret {
  display: inline-block;
  width: 0.55em;
  height: 1.05em;
  background: var(--brand);
  vertical-align: -0.15em;
  margin-left: 0.1em;
  animation: caret-blink 0.9s steps(2, start) infinite;
}

.version {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--muted);
  margin: 0.75rem 0 0;
  letter-spacing: 0.08em;
  text-transform: lowercase;
  opacity: 0;
  animation: fade-in var(--dur) var(--ease-out) forwards;
}

.status {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--muted);
  margin-top: var(--space-5);
  letter-spacing: 0.04em;
  opacity: 0;
  animation: fade-in var(--dur-slow) var(--ease-out) forwards;
}
.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--error);
  animation: live-pulse 2s var(--ease-in-out) infinite;
}
.status-dot.online {
  background: var(--success);
}
.status-addr {
  color: var(--text);
}

@keyframes row-rise {
  from {
    opacity: 0;
    transform: translateY(2px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@keyframes char-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes caret-blink {
  0%,
  49% {
    opacity: 1;
  }
  50%,
  100% {
    opacity: 0;
  }
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
