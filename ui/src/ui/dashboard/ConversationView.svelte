<script lang="ts">
import type { ConversationMessage } from "shared/dashboard-types";
import {
  formatToolCallLabel,
  groupToolCalls,
  normalizeContent,
  resolveToolName,
} from "../utils";
import TruncatableText from "../TruncatableText.svelte";

let {
  messages = [] as ConversationMessage[],
  responseText,
}: {
  messages?: ConversationMessage[];
  responseText?: string;
} = $props();
</script>

<div class="conv-messages">
  {#each messages as msg}
    {@const toolName =
      msg.role === "tool" && msg.tool_call_id
        ? resolveToolName(messages, msg.tool_call_id)
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
            {#each groupToolCalls(msg.tool_calls ?? []) as tc}
              <span class="tool-call-badge"
                >{formatToolCallLabel(tc)}</span
              >
            {/each}
          </div>
        {/if}
        {#if hasContent || (!hasToolCalls && !hasContent)}
          <TruncatableText text={normalizeContent(msg.content)} />
        {/if}
      </div>
    </div>
  {/each}
  {#if responseText}
    <div class="conv-msg assistant">
      <span class="conv-role">assistant</span>
      <div class="conv-content">
        <TruncatableText text={responseText} />
      </div>
    </div>
  {/if}
</div>

<style>
  .conv-messages {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    max-height: 40vh;
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
