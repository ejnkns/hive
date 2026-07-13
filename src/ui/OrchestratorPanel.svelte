<script lang="ts">
import type {
  OrchestratorSession,
  OrchestratorMessage,
} from "./use-orchestrator.svelte";

type Props = {
  session: OrchestratorSession | null;
  onStart: (prompt: string) => void;
};

let { session, onStart }: Props = $props();
let prompt = $state("");
let expandedTools = $state<Set<number>>(new Set());
let feedEl: HTMLDivElement | undefined = $state(undefined);

function toggleTools(index: number) {
  const next = new Set(expandedTools);
  if (next.has(index)) {
    next.delete(index);
  } else {
    next.add(index);
  }
  expandedTools = next;
}

function handleSubmit() {
  if (!prompt.trim() || (session && session.status === "running")) return;
  onStart(prompt.trim());
  prompt = "";
}

function roleLabel(role: string): string {
  if (role === "assistant") return "assistant";
  if (role === "tool") return "tool result";
  return role;
}

function truncate(content: string, max: number): string {
  if (content.length <= max) return content;
  return `${content.slice(0, max)}...`;
}

$effect(() => {
  if (session?.messages && feedEl) {
    feedEl.scrollTop = feedEl.scrollHeight;
  }
});

let elapsed = $state(0);
let timer: ReturnType<typeof setInterval> | null = null;

$effect(() => {
  if (session?.status === "running") {
    elapsed = 0;
    timer = setInterval(() => {
      elapsed = Math.floor((Date.now() - session.startedAt) / 1000);
    }, 1000);
  } else {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }
});
</script>

<div class="panel">
  <div class="section-head">Orchestrator</div>

  <div class="input-row">
    <textarea
      bind:value={prompt}
      placeholder="Enter a prompt..."
      rows="3"
      disabled={session?.status === "running"}
      onkeydown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit();
      }}
    ></textarea>
    <button
      onclick={handleSubmit}
      disabled={session?.status === "running" || !prompt.trim()}
    >
      {session?.status === "running" ? "Running..." : "Run"}
    </button>
  </div>

  {#if session}
    <div class="status-bar">
      <span class="status-dot {session.status}"></span>
      <span>
        {#if session.status === "running"}
          iteration {session.iteration + 1} -- {elapsed}s elapsed
        {:else if session.status === "complete"}
          done in {session.iteration} iteration{session.iteration !== 1 ? "s" : ""} -- {session.finishReason}
        {:else if session.status === "error"}
          error: {session.error}
        {:else}
          idle
        {/if}
      </span>
    </div>

    <div class="feed" bind:this={feedEl}>
      {#each session.messages as msg, i}
        <div class="msg">
          <div class="msg-header">
            <span class="msg-role">{roleLabel(msg.role)}</span>
            {#if msg.toolCallId}
              <span class="msg-tool-id">{msg.toolCallId.slice(0, 12)}</span>
            {/if}
          </div>
          <div class="msg-content">{msg.content}</div>
          {#if msg.toolCalls && msg.toolCalls.length > 0}
            <div class="tool-calls">
              {#each msg.toolCalls as tc, ti}
                {@const idx = i * 100 + ti}
                <button class="tool-toggle" onclick={() => toggleTools(idx)}>
                  {expandedTools.has(idx) ? "v" : ">"} {tc.function.name}
                </button>
                {#if expandedTools.has(idx)}
                  <div class="tool-detail">
                    <div class="tool-args">{tc.function.arguments}</div>
                  </div>
                {/if}
              {/each}
            </div>
          {/if}
        </div>
      {/each}

      {#if session.status === "running" && session.messages.length === 0}
        <div class="waiting">waiting for model response...</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .panel {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 1rem;
  }
  .section-head {
    font-size: 0.625rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 700;
    margin-bottom: 0.5rem;
  }
  .input-row {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
  }
  textarea {
    flex: 1;
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.5rem;
    font-family: monospace;
    font-size: 0.8rem;
    resize: vertical;
  }
  button {
    background: var(--accent);
    color: var(--bg);
    border: none;
    border-radius: 4px;
    padding: 0.5rem 1rem;
    cursor: pointer;
    font-size: 0.8rem;
    white-space: nowrap;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .status-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.5rem;
    font-size: 0.7rem;
    color: var(--muted);
  }
  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--muted);
    flex-shrink: 0;
  }
  .status-dot.running {
    background: var(--accent);
    animation: pulse 1s ease-in-out infinite;
  }
  .status-dot.complete {
    background: var(--success);
  }
  .status-dot.error {
    background: var(--error);
  }
  .feed {
    margin-top: 0.75rem;
    max-height: 400px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .msg {
    background: var(--card);
    border-radius: 4px;
    padding: 0.5rem;
    font-size: 0.8rem;
  }
  .msg-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.25rem;
  }
  .msg-role {
    font-size: 0.65rem;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .msg-tool-id {
    font-size: 0.6rem;
    color: var(--muted);
    font-family: monospace;
  }
  .msg-content {
    white-space: pre-wrap;
    word-break: break-word;
  }
  .tool-calls {
    margin-top: 0.35rem;
  }
  .tool-toggle {
    background: var(--surface);
    color: var(--muted);
    font-family: monospace;
    font-size: 0.7rem;
    padding: 0.15rem 0.4rem;
    border: 1px solid var(--border);
    border-radius: 3px;
    cursor: pointer;
    margin-top: 0.2rem;
  }
  .tool-toggle:hover {
    color: var(--text);
  }
  .tool-detail {
    margin-top: 0.3rem;
    padding: 0.4rem;
    background: var(--surface);
    border-radius: 3px;
    font-family: monospace;
    font-size: 0.7rem;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 200px;
    overflow-y: auto;
  }
  .tool-args {
    color: var(--muted);
  }
  .waiting {
    color: var(--muted);
    font-size: 0.75rem;
    text-align: center;
    padding: 1rem;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
</style>
