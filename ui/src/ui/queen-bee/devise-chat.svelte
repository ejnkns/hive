<script lang="ts">
let { projectId }: Props = $props();

type Props = {
  projectId: string;
};

type Message = {
  role: "model" | "user";
  content: string;
};

let messages: Message[] = $state([]);
let input = $state("");
let loading = $state(false);
let complete = $state(false);
let spec = $state("");
let error = $state<string | null>(null);

async function startDevise(prompt: string) {
  loading = true;
  error = null;
  messages = [];
  complete = false;
  spec = "";

  try {
    const res = await fetch(`/api/queen-bee/${projectId}/devise/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });

    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      throw new Error(data.error ?? "Failed to start devise session");
    }

    const data = (await res.json()) as { question: string };
    messages = [{ role: "model", content: data.question }];
  } catch (err) {
    error = err instanceof Error ? err.message : "Unknown error";
  } finally {
    loading = false;
  }
}

async function respond(answer: string) {
  const userMsg = answer.trim();
  if (!userMsg) return;

  messages.push({ role: "user", content: userMsg });
  loading = true;
  error = null;

  try {
    const res = await fetch(`/api/queen-bee/${projectId}/devise/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: userMsg }),
    });

    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      throw new Error(data.error ?? "Failed");
    }

    const data = (await res.json()) as
      | { question: string }
      | { complete: true; spec: string };

    if ("complete" in data) {
      complete = true;
      spec = data.spec;
      messages.push({ role: "model", content: data.spec });
    } else {
      messages.push({ role: "model", content: data.question });
    }
  } catch (err) {
    error = err instanceof Error ? err.message : "Unknown error";
  } finally {
    loading = false;
  }
}

function submit() {
  const text = input.trim();
  if (!text) return;
  input = "";

  if (messages.length === 0) {
    startDevise(text);
  } else {
    respond(text);
  }
}
</script>

<div class="devise-chat">
  {#if messages.length === 0 && !loading}
    <div class="intro">
      <h2>What are we building?</h2>
      <p>
        Describe the feature or application you want to build. I'll ask clarifying
        questions until we have a concrete requirements spec.
      </p>
    </div>
  {/if}

  {#if error}
    <div class="error">{error}</div>
  {/if}

  <div class="messages" class:has-messages={messages.length > 0}>
    {#each messages as msg}
      <div class="message" class:model={msg.role === "model"} class:user={msg.role === "user"}>
        <div class="role-label">{msg.role === "model" ? "Queen Bee" : "You"}</div>
        <div class="content">
          {#if msg.role === "model" && complete && msg.content === spec}
            <pre class="spec">{msg.content}</pre>
          {:else}
            {msg.content}
          {/if}
        </div>
      </div>
    {/each}

    {#if loading}
      <div class="message model">
        <div class="role-label">Queen Bee</div>
        <div class="content loading-dots">Thinking...</div>
      </div>
    {/if}
  </div>

  {#if !complete}
    <div class="input-area">
      <input
        type="text"
        bind:value={input}
        placeholder={
          messages.length === 0
            ? "Describe your project..."
            : "Your answer..."
        }
        disabled={loading}
        onkeydown={(e) => {
          if (e.key === "Enter") submit();
        }}
      />
      <button class="btn btn-primary" onclick={submit} disabled={loading || !input.trim()}>
        {loading ? "..." : "Send"}
      </button>
    </div>
  {/if}
</div>

<style>
  .devise-chat {
    max-width: 680px;
    margin: 0 auto;
    padding: 1.5rem 1.25rem;
  }

  .intro {
    text-align: center;
    padding: 2rem 1rem;
  }

  .intro h2 {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--text);
    margin: 0 0 0.5rem 0;
  }

  .intro p {
    font-size: 0.875rem;
    color: var(--muted);
    margin: 0;
    line-height: 1.5;
  }

  .error {
    background: rgba(220, 60, 60, 0.1);
    border: 1px solid rgba(220, 60, 60, 0.3);
    color: #dc3c3c;
    padding: 0.75rem 1rem;
    border-radius: 6px;
    font-size: 0.8125rem;
    margin-bottom: 1rem;
  }

  .messages {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .messages.has-messages {
    margin-bottom: 1.5rem;
  }

  .message {
    padding: 0.75rem 1rem;
    border-radius: 8px;
    font-size: 0.875rem;
    line-height: 1.55;
  }

  .message.model {
    background: var(--card);
    border: 1px solid var(--border);
    color: var(--text);
  }

  .message.user {
    background: rgba(var(--accent-rgb), 0.08);
    border: 1px solid rgba(var(--accent-rgb), 0.15);
    color: var(--text);
  }

  .role-label {
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.375rem;
  }

  .spec {
    font-family: var(--font-mono, monospace);
    font-size: 0.8125rem;
    white-space: pre-wrap;
    margin: 0;
    color: var(--text);
  }

  .loading-dots {
    color: var(--muted);
  }

  .input-area {
    display: flex;
    gap: 0.5rem;
  }

  input {
    flex: 1;
    padding: 0.625rem 0.75rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 0.875rem;
    font-family: inherit;
  }

  input:focus {
    outline: none;
    border-color: var(--accent);
  }

  input:disabled {
    opacity: 0.5;
  }

  .btn {
    padding: 0.625rem 1rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    background: var(--surface);
    color: var(--text);
    white-space: nowrap;
  }

  .btn:hover:not(:disabled) {
    background: var(--border);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .btn-primary {
    background: var(--accent);
    color: #1b1601;
    border-color: var(--accent);
  }
</style>
