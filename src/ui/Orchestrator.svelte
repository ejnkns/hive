<script lang="ts">
let prompt = $state("");
let loading = $state(false);
let result: {
  messages: {
    role: string;
    content: string;
    tool_calls?: unknown[];
    tool_call_id?: string;
  }[];
  finish_reason: string;
  final_content: string;
  iterations: number;
} | null = $state(null);
let error: string | null = $state(null);

async function run() {
  if (!prompt.trim() || loading) return;
  loading = true;
  result = null;
  error = null;

  const messages = [{ role: "user", content: prompt.trim() }];

  try {
    const res = await fetch("/api/orchestrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });
    const data = await res.json();
    if (!res.ok) {
      error = data.error ?? `HTTP ${res.status}`;
    } else {
      result = data;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    loading = false;
  }
}

function roleLabel(role: string): string {
  if (role === "assistant") return "assistant";
  if (role === "tool") return "tool result";
  return role;
}
</script>

<div class="orchestrator">
  <div class="section-head">Orchestrator</div>
  <div class="input-row">
    <textarea
      bind:value={prompt}
      placeholder="Enter a prompt..."
      rows="3"
      disabled={loading}
      onkeydown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run();
      }}
    ></textarea>
    <button onclick={run} disabled={loading || !prompt.trim()}>
      {loading ? "Running..." : "Run"}
    </button>
  </div>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if result}
    <div class="result">
      <div class="result-meta">
        <span>iterations: {result.iterations}</span>
        <span>finish: {result.finish_reason}</span>
      </div>
      <div class="messages">
        {#each result.messages as msg}
          <div class="msg">
            <div class="msg-role">{roleLabel(msg.role)}</div>
            <div class="msg-content">{msg.content}</div>
            {#if msg.tool_calls && msg.tool_calls.length > 0}
              <div class="tool-calls">
                {#each msg.tool_calls as tc}
                  <div class="tool-call">
                    call: {(tc as { function?: { name?: string } }).function?.name ?? "unknown"}
                    ({(tc as { function?: { arguments?: string } }).function?.arguments ?? ""})
                  </div>
                {/each}
              </div>
            {/if}
            {#if msg.tool_call_id}
              <div class="tool-call-id">tool_call_id: {msg.tool_call_id}</div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .orchestrator {
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
  .error {
    color: var(--error);
    font-size: 0.8rem;
    margin-top: 0.5rem;
  }
  .result {
    margin-top: 0.75rem;
  }
  .result-meta {
    display: flex;
    gap: 1rem;
    font-size: 0.7rem;
    color: var(--muted);
    margin-bottom: 0.5rem;
  }
  .messages {
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
  .msg-role {
    font-size: 0.65rem;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.25rem;
  }
  .msg-content {
    white-space: pre-wrap;
    word-break: break-word;
  }
  .tool-calls {
    margin-top: 0.35rem;
    font-size: 0.7rem;
    color: var(--muted);
  }
  .tool-call {
    font-family: monospace;
    background: var(--surface);
    padding: 0.2rem 0.4rem;
    border-radius: 3px;
    margin-top: 0.2rem;
    word-break: break-all;
  }
  .tool-call-id {
    font-size: 0.65rem;
    color: var(--muted);
    margin-top: 0.2rem;
  }
</style>
