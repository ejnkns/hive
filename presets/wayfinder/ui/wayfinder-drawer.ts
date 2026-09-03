/** The wayfinder in-context detail drawer (served-module sibling of the flow
 * component): the right-side drawer (bottom sheet on narrow viewports) that
 * opens when a map node is selected, rendering the selected WorkflowItem's
 * full detail — derived presentation, actual workflow state, type,
 * question/brief, the resolution task output, the persisted decision record,
 * the recorded map on the charting anchors (standing notes plus the
 * persisted map.md document, verbatim as markdown), branch/worktree data,
 * navigable blocker/dependent references, the live interactive chat session,
 * and the available actions — without routing away from the map. The map
 * shell (map-shell.ts) composes it by constructor and renders it over the map
 * body while a selection is active; the drawer itself is a thin renderer over
 * the pure view model (wayfinder-drawer-model.ts) the shell derives. The
 * mobile face is driven by a matchMedia-checked `data-compact` attribute (the
 * CSS keys off the attribute, not a bare media query) so the responsive
 * structure is testable in jsdom; a real browser verifies the feel. Escape
 * dismisses from anywhere (the drawer listens on the document while
 * attached); the close button, the reference chips, and the action buttons
 * are real buttons, so the drawer is keyboard-reachable. */

import type { FlowComponentDeps } from "workflow-engine/workflow-types";
import type {
  DrawerDetail,
  DrawerResolution,
} from "./wayfinder-drawer-model.ts";

// The public drawer contract the shell syncs each render: the derived detail
// (or none — the drawer renders nothing without a selection) and the
// callbacks wired once at construction. Intersected with HTMLElement so the
// constructor type stays assignable to the served ElementConstructor
// contract.
export type WayfinderDrawerElement = HTMLElement & {
  detail: DrawerDetail | undefined;
  onClose: (() => void) | undefined;
  /** Select another node (a blocker/dependent chip) — the shell swaps the
   * selection and re-highlights the map; never the flow's route-oriented
   * onSelect seam. */
  onNavigate: ((id: string) => void) | undefined;
  onAction: ((id: string, actionId: string) => void) | undefined;
  onSendMessage: ((id: string, content: string) => Promise<void>) | undefined;
};

export function createWayfinderDrawer(
  lit: FlowComponentDeps
): new () => WayfinderDrawerElement {
  const { LitElement: Base, html, css, utilities, nothing } = lit;

  class WayfinderDrawer extends Base {
    static properties = {
      detail: { attribute: false },
      onClose: { attribute: false },
      onNavigate: { attribute: false },
      onAction: { attribute: false },
      onSendMessage: { attribute: false },
    };

    static styles = [
      utilities,
      css`
      :host {
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        width: min(340px, 46%);
        z-index: 6;
        display: flex;
        flex-direction: column;
        min-height: 0;
        background: var(--wf-paper, var(--surface));
        border-left: 1px solid var(--wf-paper-edge, var(--border));
        box-shadow: -6px 0 18px rgba(0, 0, 0, 0.28);
        animation: drawer-in 0.18s ease-out;
        font-family: var(--wf-font);
      }
      /* The mobile face: a bottom sheet that slides up over the map's lower
         edge. The width query is mirrored in JS (matchMedia -> the reflected
         data-compact attribute) so the responsive structure is testable in
         jsdom; the CSS keys off the attribute, not a bare media query. */
      :host([data-compact]) {
        top: auto;
        left: 0;
        right: 0;
        bottom: 0;
        width: auto;
        max-height: 56vh;
        border-left: none;
        border-top: 1px solid var(--wf-paper-edge, var(--border));
        border-radius: 14px 14px 0 0;
        animation: drawer-up 0.22s ease-out;
      }
      @keyframes drawer-in {
        from {
          opacity: 0;
          transform: translateX(18px);
        }
        to {
          opacity: 1;
          transform: none;
        }
      }
      @keyframes drawer-up {
        from {
          opacity: 0;
          transform: translateY(18px);
        }
        to {
          opacity: 1;
          transform: none;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        :host,
        :host([data-compact]) {
          animation: none;
        }
      }

      .drawer {
        outline: none;
      }
      .drawer-head {
        padding: 0.75rem 0.85rem 0.5rem;
        border-bottom: 1px dashed var(--wf-paper-edge, var(--border));
      }
      .drawer-title {
        gap: 0.15rem;
      }
      .drawer-kicker {
        font-size: 0.58rem;
        color: var(--wf-body, var(--muted));
      }
      .drawer-name {
        margin: 0;
        font-size: 0.92rem;
        color: var(--wf-ink, var(--text));
        overflow-wrap: anywhere;
      }
      .drawer-close {
        font: inherit;
        font-size: 0.85rem;
        line-height: 1;
        width: 26px;
        height: 26px;
        border-radius: 6px;
        border: 1px solid var(--wf-paper-edge, var(--border));
        background: transparent;
        color: var(--wf-body, var(--muted));
        cursor: pointer;
      }
      .drawer-close:hover {
        color: var(--wf-accent);
        border-color: var(--wf-accent);
      }

      .drawer-status {
        gap: 0.4rem;
        padding: 0.45rem 0.85rem;
        border-bottom: 1px solid var(--wf-paper-edge, var(--border));
      }
      .status-chip {
        font-size: 0.58rem;
        letter-spacing: 0.08em;
        padding: 0.12rem 0.5rem;
        border-radius: 999px;
        border: 1px solid var(--wf-paper-edge, var(--border));
        color: var(--wf-body, var(--muted));
      }
      .status-chip.frontier {
        color: var(--wf-accent);
        border-color: color-mix(in srgb, var(--wf-accent) 55%, transparent);
      }
      .status-chip.blocked {
        color: #d0b3b3;
      }
      .status-chip.active {
        color: #d29922;
      }
      .status-chip.decision {
        color: #3fb950;
      }
      .state-label {
        font-size: 0.62rem;
        color: var(--wf-body, var(--muted));
      }
      .type-label {
        font-size: 0.58rem;
        letter-spacing: 0.06em;
        color: var(--wf-body, var(--muted));
        border: 1px solid var(--wf-paper-edge, var(--border));
        padding: 0.06rem 0.4rem;
      }

      .drawer-body {
        padding: 0.6rem 0.85rem 0.9rem;
        gap: 0.8rem;
      }
      .drawer-question {
        margin: 0;
        font-size: 0.78rem;
        line-height: 1.4;
        color: var(--wf-ink, var(--text));
      }
      .drawer-section {
        gap: 0.35rem;
      }
      .drawer-section-title {
        margin: 0;
        font-size: 0.6rem;
        color: var(--wf-body, var(--muted));
      }
      .resolution-block {
        gap: 0.3rem;
      }
      .resolution-gist {
        margin: 0;
        font-size: 0.66rem;
        font-style: italic;
        color: var(--wf-body, var(--muted));
      }
      .resolution-text {
        margin: 0;
        font-size: 0.72rem;
        line-height: 1.4;
        color: var(--wf-ink, var(--text));
        white-space: pre-wrap;
      }
      .resolution-meta {
        margin: 0;
        font-size: 0.6rem;
      }
      .resolution-error {
        font-size: 0.66rem;
        color: var(--error);
        border: 1px solid color-mix(in srgb, var(--error) 45%, transparent);
        padding: 0.35rem 0.55rem;
      }
      .map-document-empty {
        font-size: 0.66rem;
        border: 1px dashed var(--wf-paper-edge, var(--border));
        padding: 0.4rem 0.55rem;
      }
      .standing-notes {
        margin: 0;
        font-size: 0.72rem;
        line-height: 1.4;
        color: var(--wf-ink, var(--text));
        white-space: pre-wrap;
      }
      .branch-line {
        margin: 0;
        font-size: 0.6rem;
        font-family: var(--font-mono, monospace);
        overflow-wrap: anywhere;
      }
      .ref-chips {
        gap: 0.35rem;
      }
      .ref-chip {
        font: inherit;
        font-size: 0.64rem;
        padding: 0.24rem 0.55rem;
        border-radius: 999px;
        border: 1px solid var(--wf-accent);
        background: transparent;
        color: var(--wf-accent);
        cursor: pointer;
      }
      .ref-chip:hover {
        background: color-mix(in srgb, var(--wf-accent) 12%, transparent);
      }
      .review-finding {
        padding: 0.35rem 0.5rem;
        gap: 0.15rem;
      }
      .review-axis {
        font-size: 0.58rem;
        letter-spacing: 0.05em;
      }
      .review-severity {
        font-size: 0.56rem;
      }
      .review-detail {
        margin: 0;
        font-size: 0.64rem;
        color: var(--text);
      }
      .plan-ticket {
        padding: 0.4rem 0.55rem;
      }
      .plan-ticket-title {
        font-size: 0.68rem;
        color: var(--text);
      }
      .plan-ticket-desc {
        margin: 0.1rem 0 0;
        font-size: 0.62rem;
      }
      .drawer-actions {
        gap: 0.4rem;
      }
      .drawer-actions button {
        font-family: inherit;
        font-size: 0.68rem;
        padding: 0.3rem 0.65rem;
        border-radius: 6px;
        border: 1px solid var(--wf-accent);
        background: transparent;
        color: var(--wf-accent);
        cursor: pointer;
      }
      .drawer-actions button.primary {
        background: var(--wf-accent);
        color: var(--bg);
        border-color: transparent;
      }
      .drawer-actions button.destructive {
        background: var(--error);
        color: white;
        border-color: transparent;
      }
      .drawer-actions button.secondary {
        border-color: var(--border);
        color: var(--muted);
      }
      .drawer-chat {
        border-top: 1px dashed var(--border);
        padding-top: 0.5rem;
      }
    `,
    ];

    declare detail: DrawerDetail | undefined;
    declare onClose: (() => void) | undefined;
    declare onNavigate: ((id: string) => void) | undefined;
    declare onAction: ((id: string, actionId: string) => void) | undefined;
    declare onSendMessage:
      | ((id: string, content: string) => Promise<void>)
      | undefined;

    // The narrow-viewport media query backing the bottom-sheet face. Kept
    // off the reactive path: applyCompact toggles the reflected attribute
    // directly, so a viewport change never re-renders the content.
    private mediaQuery: MediaQueryList | undefined;

    // Focus is moved into the drawer once per open (the flag resets on
    // connect), so keyboard users land inside the panel and Escape works
    // immediately; a mouse user's click focus is not disturbed.
    private focusedOnce = false;

    connectedCallback(): void {
      super.connectedCallback();
      this.focusedOnce = false;
      document.addEventListener("keydown", this.onDocumentKeydown);
      if (typeof matchMedia === "function") {
        this.mediaQuery = matchMedia("(max-width: 900px)");
        this.mediaQuery.addEventListener?.("change", this.applyCompact);
      }
      this.applyCompact();
    }

    disconnectedCallback(): void {
      document.removeEventListener("keydown", this.onDocumentKeydown);
      this.mediaQuery?.removeEventListener?.("change", this.applyCompact);
      this.mediaQuery = undefined;
      super.disconnectedCallback();
    }

    protected override updated(): void {
      // The detail arrives one cycle after attach (the shell syncs the
      // derived model after its render); focus the panel then, once.
      if (this.detail !== undefined && !this.focusedOnce) {
        this.focusedOnce = true;
        this.renderRoot
          .querySelector<HTMLElement>(".drawer")
          ?.focus({ preventScroll: true });
      }
    }

    private onDocumentKeydown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") this.onClose?.();
    };

    // The mobile face: reflect the narrow-viewport match on the host so the
    // CSS can switch the drawer to a bottom sheet.
    private applyCompact = (): void => {
      this.toggleAttribute("data-compact", this.mediaQuery?.matches ?? false);
    };

    render() {
      const detail = this.detail;
      if (detail === undefined) return nothing;
      return html`<div
        class="drawer flex-1 min-h-0 flex flex-col"
        role="region"
        aria-label="WorkflowItem detail"
        tabindex="-1"
      >
        <header class="drawer-head flex-none flex items-start gap-2">
          <div class="drawer-title flex-1 min-w-0 flex flex-col">
            <span class="drawer-kicker tracking-wide uppercase">${detail.presentationLabel}</span>
            <h2 class="drawer-name font-bold">${detail.title}</h2>
          </div>
          <button
            class="drawer-close flex-none"
            type="button"
            aria-label="Close detail"
            @click=${() => this.onClose?.()}
          >
            ×
          </button>
        </header>
        <div class="drawer-status flex-none flex items-center flex-wrap">
          <span class="status-chip uppercase ${detail.presentation}"
            >${detail.presentationLabel}</span
          >
          <span class="state-label">${detail.stateLabel}</span>
          ${
            detail.type !== undefined
              ? html`<span class="type-label uppercase rounded-sm">${detail.type}</span>`
              : nothing
          }
        </div>
        <div class="drawer-body flex-1 min-h-0 overflow-y-auto flex flex-col">
          ${
            detail.question !== undefined
              ? html`<p class="drawer-question">${detail.question}</p>`
              : nothing
          }
          ${this.renderResolution(detail)}
          ${this.renderStandingNotes(detail)}
          ${this.renderMapDocument(detail)}
          ${
            detail.decisionRecord !== undefined
              ? html`<section class="drawer-section flex flex-col">
                <h3 class="drawer-section-title tracking-wide uppercase">Decision record</h3>
                <markdown-view .content=${detail.decisionRecord}></markdown-view>
              </section>`
              : nothing
          }
          ${this.renderWorkspace(detail)}
          ${this.renderReferences(detail)}
          ${this.renderChat(detail)}
          ${this.renderActions(detail)}
        </div>
      </div>`;
    }

    // The resolution task output: research findings (markdown), a chat
    // resolution's decision + gist, the build worker outcome, the reviewer
    // verdict + findings, or the build plan tickets. When nothing succeeded,
    // the first resolution error names the reason the run stopped.
    private renderResolution(detail: DrawerDetail) {
      if (detail.resolution.length === 0) {
        return detail.resolutionError !== undefined
          ? html`<div class="resolution-error rounded-md">${detail.resolutionError}</div>`
          : nothing;
      }
      return html`<section class="drawer-section flex flex-col">
        ${detail.resolution.map((entry) => this.renderResolutionBlock(entry))}
      </section>`;
    }

    private renderResolutionBlock(resolution: DrawerResolution) {
      switch (resolution.kind) {
        case "research":
          return html`<div class="resolution-block flex flex-col">
            <h3 class="drawer-section-title tracking-wide uppercase">Research findings</h3>
            <markdown-view .content=${resolution.findings}></markdown-view>
            ${
              resolution.sources.length > 0
                ? html`<p class="resolution-meta text-muted"
                  >${resolution.sources.length} sources</p
                >`
                : nothing
            }
          </div>`;
        case "decision":
          return html`<div class="resolution-block flex flex-col">
            <h3 class="drawer-section-title tracking-wide uppercase">Resolution</h3>
            ${
              resolution.gist !== ""
                ? html`<p class="resolution-gist">${resolution.gist}</p>`
                : nothing
            }
            ${
              resolution.decision !== ""
                ? html`<p class="resolution-text">${resolution.decision}</p>`
                : nothing
            }
            ${
              resolution.artifactPath !== undefined
                ? html`<p class="resolution-meta text-muted"
                  >artifact: ${resolution.artifactPath}</p
                >`
                : nothing
            }
          </div>`;
        case "build-outcome":
          return html`<div class="resolution-block flex flex-col">
            <h3 class="drawer-section-title"
              >Build outcome · ${resolution.outcome}</h3
            >
            ${
              resolution.summary !== ""
                ? html`<p class="resolution-text">${resolution.summary}</p>`
                : nothing
            }
          </div>`;
        case "review":
          return html`<div class="resolution-block flex flex-col">
            <h3 class="drawer-section-title"
              >Review · ${resolution.verdict}</h3
            >
            ${resolution.findings.map(
              (
                finding
              ) => html`<div class="review-finding border rounded-md flex flex-col">
                ${
                  finding.axis !== ""
                    ? html`<span class="review-axis text-muted font-bold uppercase">${finding.axis}</span>`
                    : nothing
                }
                ${
                  finding.severity !== ""
                    ? html`<span class="review-severity text-error"
                      >${finding.severity}</span
                    >`
                    : nothing
                }
                ${
                  finding.detail !== ""
                    ? html`<p class="review-detail">${finding.detail}</p>`
                    : nothing
                }
              </div>`
            )}
          </div>`;
        case "plan":
          return html`<div class="resolution-block flex flex-col">
            <h3 class="drawer-section-title tracking-wide uppercase">Build plan</h3>
            ${resolution.tickets.map(
              (planTicket) => html`<div class="plan-ticket border rounded-md">
                <div class="plan-ticket-title font-bold">${planTicket.title}</div>
                ${
                  planTicket.description !== ""
                    ? html`<p class="plan-ticket-desc text-muted"
                      >${planTicket.description}</p
                    >`
                    : nothing
                }
              </div>`
            )}
          </div>`;
      }
    }

    // The recorded map, on the charting anchors: the standing notes the
    // submit_map recording carries, and the persisted map document — the
    // chart's content, rendered verbatim as markdown. Before settle_chart
    // has persisted the document, the section degrades to its empty state
    // instead of hiding (the anchor owns the document either way).
    private renderStandingNotes(detail: DrawerDetail) {
      if (detail.notes === undefined) return nothing;
      return html`<section class="drawer-section flex flex-col">
        <h3 class="drawer-section-title tracking-wide uppercase">Standing notes</h3>
        <p class="standing-notes">${detail.notes}</p>
      </section>`;
    }

    private renderMapDocument(detail: DrawerDetail) {
      if (detail.mapDocument === undefined) return nothing;
      return html`<section class="drawer-section flex flex-col">
        <h3 class="drawer-section-title tracking-wide uppercase">Map document</h3>
        ${
          detail.mapDocument !== ""
            ? html`<markdown-view
                .content=${detail.mapDocument}
              ></markdown-view>`
            : html`<div class="map-document-empty text-muted rounded-md">
                No map recorded yet — the chart persists when the frontier
                settles.
              </div>`
        }
      </section>`;
    }

    private renderWorkspace(detail: DrawerDetail) {
      if (detail.branch === undefined && detail.worktree === undefined) {
        return nothing;
      }
      const parts = [detail.branch, detail.worktree].filter(
        (value): value is string => value !== undefined
      );
      return html`<section class="drawer-section flex flex-col">
        <h3 class="drawer-section-title tracking-wide uppercase">Workspace</h3>
        <p class="branch-line text-muted">${parts.join(" · ")}</p>
      </section>`;
    }

    // The blocker and dependent references: chips that select the referenced
    // node — updating the drawer and the map highlight, never navigating away.
    private renderReferences(detail: DrawerDetail) {
      const hasBlockers = detail.blockers.length > 0;
      const hasDependents = detail.dependents.length > 0;
      if (!hasBlockers && !hasDependents) return nothing;
      return html`<section class="drawer-section flex flex-col">
        ${
          hasBlockers
            ? html`<h3 class="drawer-section-title tracking-wide uppercase">Blocks on</h3>
              <div class="ref-chips flex flex-wrap">
                ${detail.blockers.map((ref) => this.renderRef(ref))}
              </div>`
            : nothing
        }
        ${
          hasDependents
            ? html`<h3 class="drawer-section-title tracking-wide uppercase">Dependents</h3>
              <div class="ref-chips flex flex-wrap">
                ${detail.dependents.map((ref) => this.renderRef(ref))}
              </div>`
            : nothing
        }
      </section>`;
    }

    private renderRef(ref: { id: string; title: string }) {
      return html`<button
        class="ref-chip"
        type="button"
        data-id=${ref.id}
        @click=${() => this.onNavigate?.(ref.id)}
      >
        ${ref.title}
      </button>`;
    }

    // The live interactive session, composed through the default
    // <chat-session> element with the same onSendMessage seam the cards use.
    private renderChat(detail: DrawerDetail) {
      const chat = detail.chat;
      if (chat === undefined) return nothing;
      return html`<section class="drawer-section drawer-chat">
        <h3 class="drawer-section-title tracking-wide uppercase">Session</h3>
        <chat-session
          .messages=${chat.messages}
          .sessionId=${chat.sessionId}
          .interactive=${chat.interactive}
          .thinking=${chat.thinking}
          .modelStatus=${chat.modelStatus}
          @hive-send-message=${(event: CustomEvent<{ content: string }>) => {
            this.onSendMessage?.(
              detail.node.instanceId ?? detail.node.id,
              event.detail.content
            );
          }}
        ></chat-session>
      </section>`;
    }

    // The instance's available state actions — data-driven through the same
    // onAction seam as every other wayfinder surface.
    private renderActions(detail: DrawerDetail) {
      if (detail.actions.length === 0) return nothing;
      return html`<section class="drawer-section flex flex-col">
        <h3 class="drawer-section-title tracking-wide uppercase">Actions</h3>
        <div class="drawer-actions flex flex-wrap">
          ${detail.actions.map(
            (action) => html`<button
              class=${action.variant}
              type="button"
              @click=${() =>
                this.onAction?.(
                  detail.node.instanceId ?? detail.node.id,
                  action.id
                )}
            >
              ${action.label}
            </button>`
          )}
        </div>
      </section>`;
    }
  }

  return WayfinderDrawer;
}
