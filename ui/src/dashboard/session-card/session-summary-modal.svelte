<script lang="ts">
import type { RequestState, SessionState } from "shared/dashboard-types";
import Modal from "../../shared/Modal.svelte";
import TruncatableText from "../../shared/TruncatableText.svelte";
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
</style>
