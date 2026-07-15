<script lang="ts">
import type { ConversationData } from "./types";
import { esc, formatNumber, normalizeContent } from "./utils";

let { data = [] as ConversationData[] } = $props();
</script>

{#if data.length === 0}
  <div class="no-data">Awaiting conversations...</div>
{:else}
  {#each data as c}
    <div class="conv">
      <div class="conv-header">
        <span class="conv-prov">{c.provider}</span>
        <span class="conv-model">{c.model}</span>
        <span class="conv-status">{c.success ? String(c.statusCode) : "ERR"}</span>
        <span class="conv-latency">{formatNumber(c.totalLatency, "ms")}</span>
        <span class="conv-tokens">{c.outputTokens != null ? String(c.outputTokens) : "—"} tok</span>
      </div>
      <div class="conv-messages">
        {#each c.prompt as msg}
          <div class="conv-msg {msg.role}">
            <span class="conv-role">{msg.role}</span>
            <span class="conv-text">{normalizeContent(msg.content ?? "")}</span>
          </div>
        {/each}
        {#if c.responseText}
          <div class="conv-msg assistant">
            <span class="conv-role">assistant</span>
            <span class="conv-text">{esc(c.responseText.slice(0, 500))}</span>
          </div>
        {/if}
      </div>
    </div>
  {/each}
{/if}

<style>
  .no-data { padding: 1.5rem; text-align: center; color: var(--muted); font-size: 0.8125rem; }
  .conv { border: 1px solid var(--border); margin-bottom: 0.5rem; background: var(--card); }
  .conv-header {
    display: flex; gap: 0.75rem; align-items: center;
    padding: 0.375rem 0.625rem;
    background: var(--surface);
    font-size: 0.6875rem;
    border-bottom: 1px solid var(--border);
  }
  .conv-prov { text-transform: capitalize; font-weight: 600; }
  .conv-model { font-family: monospace; font-size: 0.625rem; color: var(--accent); }
  .conv-status { color: var(--success); font-weight: 700; }
  .conv-latency { color: var(--muted); }
  .conv-tokens { color: var(--muted); }
  .conv-messages { padding: 0.5rem; display: flex; flex-direction: column; gap: 0.5rem; }
  .conv-msg { display: flex; gap: 0.5rem; font-size: 0.75rem; }
  .conv-role { font-size: 0.625rem; font-weight: 700; min-width: 60px; text-transform: uppercase; color: var(--muted); }
  .conv-msg.system .conv-role { color: var(--accent); }
  .conv-msg.user .conv-role { color: var(--text); }
  .conv-msg.assistant .conv-role { color: var(--success); }
  .conv-msg.tool .conv-role { color: var(--warning); }
  .conv-text { word-break: break-word; }
</style>
