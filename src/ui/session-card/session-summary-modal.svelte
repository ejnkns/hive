<script lang="ts">
import type { RequestState, SessionState } from "../types";
import {
  formatToolCallLabel,
  groupToolCalls,
  normalizeContent,
  resolveToolName,
} from "../utils";
import Modal from "../Modal.svelte";
import TruncatableText from "../TruncatableText.svelte";
import Timeline from "./timeline.svelte";
import RequestDetailModal from "./request-detail-modal.svelte";

let {
  open = $bindable(false),
  session,
  onOpenDetail,
}: {
  open?: boolean;
  session: SessionState;
  onOpenDetail?: (req: RequestState) => void;
} = $props();

const latest = $derived(session.requests.at(-1) ?? null);
const requestCount = $derived(session.requests.length);

const hasConversation = $derived(
  latest &&
    ((latest.conversationPrompt && latest.conversationPrompt.length > 0) ||
      !!latest.responseText)
);

function handleTimelineClick(req: RequestState) {
  open = false;
  onOpenDetail?.(req);
}
</script>

<Modal bind:open title="Session Summary">
  <div class="modal-body">
    <div class="session-info">
      <span class="info-label">Provider</span>
      <span class="info-val"
        >{latest?.provider ?? "—"}:{latest?.model ?? "—"}</span
      >
      <span class="info-label">Requests</span>
      <span class="info-val">{String(requestCount)}</span>
      {#if session.fingerprint}
        <span class="info-label">Fingerprint</span>
        <span class="info-val mono">{session.fingerprint.slice(0, 8)}</span>
      {/if}
    </div>

    {#if hasConversation}
      <div class="section">
        <div class="section-title">latest request conversation</div>
        <div class="conv-messages">
          {#each latest.conversationPrompt ?? [] as msg}
            {@const toolName =
              msg.role === "tool" && msg.tool_call_id
                ? resolveToolName(
                    latest.conversationPrompt ?? [],
                    msg.tool_call_id
                  )
                : null}
            {@const hasToolCalls =
              msg.role === "assistant" &&
              msg.tool_calls &&
              msg.tool_calls.length > 0}
            {@const hasContent = normalizeContent(msg.content).length > 0}
            <div class="conv-msg {msg.role}">
              <span class="conv-role">{toolName ?? msg.role}</span>
              <div class="conv-content">
                {#if hasToolCalls}
                  <div class="tool-call-list">
                    {#each groupToolCalls(msg.tool_calls) as tc}
                      <span class="tool-call-badge"
                        >{formatToolCallLabel(tc)}</span
                      >
                    {/each}
                  </div>
                {/if}
                {#if hasContent || (!hasToolCalls && !hasContent)}
                  <TruncatableText
                    text={normalizeContent(msg.content)}
                    maxLength={200}
                  />
                {/if}
              </div>
            </div>
          {/each}
          {#if latest.responseText}
            <div class="conv-msg assistant">
              <span class="conv-role">assistant</span>
              <div class="conv-content">
                <TruncatableText
                  text={latest.responseText}
                  maxLength={400}
                />
              </div>
            </div>
          {/if}
        </div>
      </div>
    {:else if latest?.prompt}
      <div class="section">
        <div class="section-title">latest prompt</div>
        <TruncatableText text={latest.prompt} maxLength={200} />
      </div>
    {/if}

    <div class="section">
      <div class="section-title">request flow</div>
      <Timeline
        requests={session.requests}
        onRequestClick={handleTimelineClick}
      />
    </div>
  </div>
</Modal>

<style>
  .modal-body {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .session-info {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.125rem 0.75rem;
    font-size: 0.6875rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--border);
  }

  .info-label {
    color: var(--muted);
  }

  .info-val {
    color: var(--text);
  }

  .info-val.mono {
    font-family: monospace;
    font-size: 0.5625rem;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .section-title {
    font-size: 0.5625rem;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--muted);
  }

  .conv-messages {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    max-height: 30vh;
    overflow-y: auto;
  }

  .conv-msg {
    display: flex;
    gap: 0.375rem;
    font-size: 0.75rem;
  }

  .conv-role {
    font-size: 0.5625rem;
    font-weight: 700;
    min-width: 55px;
    text-transform: uppercase;
    color: var(--muted);
    flex-shrink: 0;
  }

  .conv-msg.system .conv-role {
    color: var(--accent);
  }

  .conv-msg.user .conv-role {
    color: var(--text);
  }

  .conv-msg.assistant .conv-role {
    color: var(--success);
  }

  .conv-msg.tool .conv-role {
    color: var(--warning);
  }

  .conv-content {
    flex: 1;
    min-width: 0;
  }

  .tool-call-list {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
    margin-bottom: 0.25rem;
  }

  .tool-call-badge {
    display: inline-block;
    font-size: 0.5rem;
    font-weight: 700;
    padding: 0.0625rem 0.25rem;
    text-transform: uppercase;
    color: var(--accent);
    background: rgba(var(--border-rgb), 0.15);
    border: 1px solid rgba(var(--border-rgb), 0.3);
  }
</style>
