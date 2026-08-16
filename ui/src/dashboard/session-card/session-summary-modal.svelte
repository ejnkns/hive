<script lang="ts">
import type { RequestState, SessionState } from "shared/dashboard-types";
import TruncatableText from "../../shared/TruncatableText.svelte";
import Dialog from "../../shared/ui/Dialog.svelte";
import ConversationView from "../ConversationView.svelte";
import RequestDetailModal from "./request-detail-modal.svelte";
import Timeline from "./timeline.svelte";

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

<Dialog bind:open label="Session Summary">
  <h2 class="dialog-title">session summary</h2>
  <div class="modal-body">
    <div class="session-info">
      <span class="info-label">provider</span>
      <span class="info-val"
        >{latest?.provider ?? "—"}:{latest?.model ?? "—"}</span
      >
      <span class="info-label">requests</span>
      <span class="info-val">{String(requestCount)}</span>
      {#if session.fingerprint}
        <span class="info-label">fingerprint</span>
        <span class="info-val mono">{session.fingerprint.slice(0, 8)}</span>
      {/if}
    </div>

    {#if hasConversation && latest}
      <div class="section">
        <div class="section-title">latest request conversation</div>
        <ConversationView
          messages={latest.conversationPrompt ?? []}
          responseText={latest.responseText}
        />
      </div>
    {:else if latest?.prompt}
      <div class="section">
        <div class="section-title">latest prompt</div>
        <TruncatableText text={latest.prompt} />
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
</Dialog>

<style>
.dialog-title {
  margin: 0 0 0.75rem 0;
  font-size: var(--text-sm);
  font-weight: 700;
}
.modal-body {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.session-info {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.125rem 0.75rem;
  font-size: var(--text-xs);
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
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.section {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.section-title {
  font-size: var(--text-xs);
  font-weight: 700;
  color: var(--muted);
}
</style>
