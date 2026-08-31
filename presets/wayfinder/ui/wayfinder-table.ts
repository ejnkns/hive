/** The wayfinder table (served-module sibling of the flow component): the
 * focused cartographer's-table workbench renderer — the seven stations (base
 * camp, briefing deck, fog tray, on-expedition, journal, supply depot,
 * do-not-enter) around the mini-map centre column. The deck reads the shared
 * presentation model, so a ready ticket with unresolved dependsOn blockers
 * presents as blocked while the claimable frontier keeps its type stamp; the
 * mini-map derives from the same WayfinderMap the full map renders. The mode
 * chrome (the header with the expedition identity, the data-driven flow
 * actions, and the Map/Table toggle) stays in table-shell.ts, which composes
 * this renderer by constructor — the workbench and the chrome stay
 * independent seams. The table is also the DOM-backed accessibility
 * alternative to the Canvas map. */

import type { WorkflowDefResponse } from "workflow-engine/create-flow-runtime";
import type {
  FlowComponentDeps,
  FlowViewProps,
  ModelCallStatus,
} from "workflow-engine/workflow-types";
import type { WayfinderView } from "./shared.ts";
import { createWayfinderDrawing } from "./wayfinder-drawing.ts";
import type { WayfinderMap } from "./wayfinder-map.ts";
import {
  implementationTitle,
  RESOLVING_STATES,
  resolvingLabel,
  ticketTitle,
} from "./wayfinder-map.ts";
import {
  agentIsThinking,
  readDecisionRecord,
  readOutcomeError,
  TICKET_RESOLUTION_TASKS,
} from "./wayfinder-status.ts";
import type { ExpeditionTheme } from "./wayfinder-themes.ts";
import { THEME_ACCENT, THEME_GLYPHS } from "./wayfinder-themes.ts";

// The entries slice of the flow-view props (kept as a named alias so the
// contract below reads tightly).
type FlowViewPropsEntries = FlowViewProps["entries"];

// The public table contract the shell syncs each render: the presentation
// model + theme, the full entries/definitions/persisted payloads the stations
// read, the hover/focus pulse ids, the session fog order, and the callbacks
// the shell wires once at construction. Intersected with HTMLElement so the
// constructor type stays assignable to the served ElementConstructor
// contract.
export type WayfinderTableElement = HTMLElement & {
  model: WayfinderMap;
  theme: ExpeditionTheme;
  entries: FlowViewPropsEntries;
  workflowDefs: readonly WorkflowDefResponse[];
  persistedOutputs: Readonly<Record<string, string>>;
  persistedOutputDirs: Readonly<
    Record<string, Readonly<Record<string, string>>>
  >;
  hoverId: string | undefined;
  focusId: string | undefined;
  fogOrder: string[];
  onAction: ((id: string, actionId: string) => void) | undefined;
  onSendMessage: ((id: string, content: string) => Promise<void>) | undefined;
  onHover: ((id: string | undefined) => void) | undefined;
  onFocus: ((id: string) => void) | undefined;
  onFogOrderChange: ((order: string[]) => void) | undefined;
  onViewChange: ((view: WayfinderView) => void) | undefined;
};

export function createWayfinderTable(
  lit: FlowComponentDeps
): new () => WayfinderTableElement {
  const { LitElement: Base, html, css, nothing, svg } = lit;
  const drawing = createWayfinderDrawing(lit);

  class WayfinderTable extends Base {
    static properties = {
      model: { attribute: false },
      theme: { type: String, reflect: true, attribute: "data-theme" },
      entries: { attribute: false },
      workflowDefs: { attribute: false },
      persistedOutputs: { attribute: false },
      persistedOutputDirs: { attribute: false },
      hoverId: { attribute: false },
      focusId: { attribute: false },
      fogOrder: { attribute: false },
      openDecisionId: { attribute: false },
      onAction: { attribute: false },
      onSendMessage: { attribute: false },
      onHover: { attribute: false },
      onFocus: { attribute: false },
      onFogOrderChange: { attribute: false },
      onViewChange: { attribute: false },
    };

    static styles = css`
      :host {
        flex: 1;
        min-height: 0;
        min-width: 0;
        display: flex;
      }
      @media (max-width: 900px) {
        :host {
          flex: none;
          flex-direction: column;
        }
        .table {
          grid-template-columns: 1fr;
          overflow: visible;
        }
        .column {
          overflow-y: visible;
        }
        .column.center {
          order: -1;
          overflow: visible;
        }
        .map-card {
          height: auto;
          min-height: 60vh;
        }
      }

      .table {
        flex: 1;
        min-height: 0;
        display: grid;
        grid-template-columns: minmax(0, 300px) minmax(0, 1fr) minmax(0, 280px);
        gap: 1rem;
        align-items: stretch;
        overflow: hidden;
        border-radius: 18px;
        padding: 1.25rem;
        border: 1px solid var(--border);
        background: var(--wf-paper);
      }
      :host([data-theme="mountain"]) .table {
        background:
          radial-gradient(
            120% 90% at 50% 10%,
            rgba(255, 255, 255, 0.05),
            transparent 60%
          ),
          repeating-linear-gradient(
            90deg,
            rgba(0, 0, 0, 0.05) 0 2px,
            transparent 2px 6px
          ),
          var(--wf-paper);
      }
      :host([data-theme="topo"]) .table {
        background:
          radial-gradient(
            120% 90% at 50% 10%,
            rgba(255, 255, 255, 0.04),
            transparent 60%
          ),
          repeating-linear-gradient(
            0deg,
            rgba(0, 0, 0, 0.04) 0 1px,
            transparent 1px 28px
          ),
          repeating-linear-gradient(
            90deg,
            rgba(0, 0, 0, 0.04) 0 1px,
            transparent 1px 28px
          ),
          var(--wf-paper);
      }
      :host([data-theme="stars"]) .table {
        background:
          radial-gradient(
            120% 100% at 50% 0%,
            rgba(91, 192, 232, 0.08),
            transparent 60%
          ),
          repeating-linear-gradient(
            90deg,
            rgba(0, 0, 0, 0.06) 0 8px,
            transparent 8px 16px
          ),
          var(--wf-paper);
      }

      .column {
        display: flex;
        flex-direction: column;
        gap: 1.1rem;
        min-width: 0;
        min-height: 0;
        overflow-y: auto;
        padding: 0.5rem 0.625rem 0.75rem;
      }
      .column.center {
        overflow: hidden;
        padding: 0;
      }
      .station-head {
        font-size: 0.68rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--wf-body);
        margin: 0 0 0.55rem;
        display: flex;
        align-items: center;
        gap: 0.45rem;
      }
      .station-head::after {
        content: "";
        flex: 1;
        height: 1px;
        background: rgba(203, 185, 143, 0.25);
      }
      .pile {
        display: flex;
        flex-direction: column;
        gap: 0.7rem;
        min-height: 40px;
      }
      .empty {
        font-size: 0.68rem;
        color: var(--muted);
        padding: 0.4rem 0;
      }
      .card .card-title,
      .card .lbl,
      .crate .card-title,
      .crate .lbl,
      .journal .txt,
      .dest-note .name,
      .dest-note .sub {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .card .body {
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }
      .journal .txt {
        min-width: 0;
      }

      .card {
        background: var(--wf-paper);
        border: 1px solid var(--wf-paper-edge);
        border-radius: 10px;
        padding: 0.75rem 0.85rem;
        box-shadow:
          0 2px 0 rgba(0, 0, 0, 0.3),
          0 5px 10px rgba(0, 0, 0, 0.3);
        transform: rotate(var(--rot, 0deg));
        transition:
          transform 0.15s ease,
          box-shadow 0.15s ease,
          border-color 0.15s;
      }
      .card:hover {
        transform: rotate(0deg) translateY(-2px);
      }
      .card.hl,
      .crate.hl,
      .journal .entry.hl {
        border-color: var(--wf-accent);
        box-shadow:
          0 0 0 2px color-mix(in srgb, var(--wf-accent) 60%, transparent),
          0 6px 14px rgba(0, 0, 0, 0.35);
      }
      .card.focus,
      .crate.focus,
      .journal .entry.focus {
        animation: cardglow 1s ease-in-out 2;
      }
      @keyframes cardglow {
        0%, 100% {
          box-shadow:
            0 0 0 0 color-mix(in srgb, var(--wf-accent) 0%, transparent);
        }
        50% {
          box-shadow:
            0 0 0 6px color-mix(in srgb, var(--wf-accent) 55%, transparent);
        }
      }
      .card,
      .crate,
      .journal .entry {
        cursor: pointer;
      }
      .card:focus-visible,
      .crate:focus-visible,
      .journal .entry:focus-visible {
        outline: 2px solid color-mix(in srgb, var(--wf-accent) 55%, transparent);
        outline-offset: 1px;
      }
      .card .card-title {
        font-weight: 600;
        font-size: 0.84rem;
        color: var(--wf-ink);
      }
      .card .body {
        font-size: 0.7rem;
        color: var(--wf-body);
        margin-top: 0.28rem;
      }
      .card .card-title,
      .card .body,
      .journal .txt,
      .crate .card-title,
      .dest-note .name {
        font-family: var(--wf-font);
      }
      .stamp {
        display: inline-block;
        font-size: 0.56rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--wf-accent);
        border: 1.5px solid var(--wf-accent);
        border-radius: 4px;
        padding: 0.06rem 0.34rem;
        margin-top: 0.5rem;
        transform: rotate(-3deg);
      }
      .stamp.blocked {
        color: var(--warning);
        border-color: var(--warning);
      }
      .card .lbl {
        font-size: 0.6rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .card-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.375rem;
        margin-top: 0.5rem;
      }
      .card-actions button {
        font: inherit;
        font-size: 0.68rem;
        padding: 0.26rem 0.6rem;
        border-radius: 6px;
        border: 1px solid var(--wf-accent);
        background: transparent;
        color: var(--wf-accent);
        cursor: pointer;
      }
      .card-actions button.primary {
        background: var(--wf-accent);
        color: var(--bg);
        border-color: transparent;
      }
      .card-actions button.destructive {
        background: var(--error);
        color: white;
        border-color: transparent;
      }
      .card-actions button.secondary {
        border-color: var(--border);
        color: var(--muted);
      }
      .task-status {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        margin-top: 0.45rem;
        font-size: 0.62rem;
        color: var(--wf-body);
      }
      .task-status .pulse {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--warning);
        animation: task-pulse 1.4s ease-in-out infinite;
      }
      @keyframes task-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
      }
      .task-error {
        margin-top: 0.45rem;
        font-size: 0.62rem;
        color: var(--error);
        border: 1px solid color-mix(in srgb, var(--error) 45%, transparent);
        border-radius: 6px;
        padding: 0.3rem 0.5rem;
      }
      .card-chat {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        border-top: 1px dashed var(--border);
        padding-top: 0.5rem;
        margin-top: 0.5rem;
      }
      .session-header {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
      }
      .session-label {
        font-size: 0.5625rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--wf-accent);
      }

      .fog-card {
        background: linear-gradient(
          165deg,
          var(--wf-paper),
          var(--wf-paper-edge)
        );
        border: 2px dashed var(--wf-body);
        cursor: grab;
      }
      .fog-card.dragging {
        opacity: 0.4;
      }
      .fog-title {
        display: flex;
        align-items: center;
        gap: 0.35rem;
      }
      .fog-title .card-title {
        flex: 1;
        min-width: 0;
      }
      .fog-card .q {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        border: 1.5px solid var(--wf-ink);
        color: var(--wf-ink);
        font-weight: 700;
        font-size: 0.85rem;
        box-shadow:
          0 0 0 4px color-mix(in srgb, var(--wf-body) 18%, transparent),
          0 0 14px color-mix(in srgb, var(--wf-body) 35%, transparent);
      }
      .fog-card .tag {
        display: inline-block;
        margin-top: 0.4rem;
        font-size: 0.56rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--wf-ink);
        background: color-mix(in srgb, var(--wf-body) 25%, transparent);
        border-radius: 999px;
        padding: 0.06rem 0.45rem;
      }

      .journal {
        background: var(--wf-paper);
        border: 1px solid var(--wf-paper-edge);
        border-radius: 10px;
        overflow: hidden;
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
      }
      .journal .entry {
        padding: 0.6rem 0.8rem;
        border-bottom: 1px dashed var(--wf-paper-edge);
        display: flex;
        gap: 0.6rem;
        align-items: baseline;
      }
      .journal .entry:last-child {
        border-bottom: none;
      }
      .journal .cairn {
        color: var(--success);
      }
      .journal .txt {
        font-size: 0.8rem;
        color: var(--wf-ink);
      }
      .journal .decision {
        padding: 0 0.8rem 0.7rem 2.2rem;
        border-bottom: 1px dashed var(--wf-paper-edge);
      }
      .journal .decision:last-child {
        border-bottom: none;
      }
      .journal .decision-empty {
        font-size: 0.72rem;
        color: var(--muted);
        font-style: italic;
      }

      .crate {
        background: var(--wf-paper);
        border: 1px solid var(--wf-paper-edge);
        border-radius: 10px;
        padding: 0.7rem 0.8rem;
        border-top: 3px solid var(--warning);
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
      }
      .crate.spec {
        border-top-color: var(--wf-accent);
      }
      .crate .lbl {
        font-size: 0.6rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .crate .card-title {
        font-weight: 600;
        font-size: 0.8rem;
        color: var(--wf-ink);
      }

      .map-card {
        height: 100%;
        display: flex;
        flex-direction: column;
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 0.9rem;
        background: var(
          --map-backdrop,
          radial-gradient(120% 90% at 70% 20%, #172030 0%, #10151d 55%, #0c1015 100%)
        );
        position: relative;
      }
      :host([data-theme="stars"]) .map-card {
        color: #ffffff;
      }
      :host-context(html.light):host([data-theme="stars"]) .map-card {
        color: #0a0e15;
      }
      .map-card .map-top {
        flex-shrink: 0;
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        margin-bottom: 0.5rem;
      }
      .map-card .dest-note {
        flex: 1;
        min-width: 0;
      }
      .map-card .dest-note .name {
        font-weight: 700;
        font-size: 0.8rem;
      }
      .map-card .dest-note .sub {
        font-size: 0.66rem;
        color: var(--muted);
      }
      .map-card .open-map {
        flex-shrink: 0;
        font: inherit;
        font-size: 0.68rem;
        padding: 0.32rem 0.6rem;
        border-radius: 6px;
        border: 1px solid var(--wf-accent);
        background: rgba(91, 192, 232, 0.12);
        color: var(--wf-accent);
        cursor: pointer;
      }
      .map-card svg {
        display: block;
        width: 100%;
        height: 100%;
        flex: 1;
        min-height: 0;
      }
      .marker {
        transition: transform 0.15s ease, opacity 0.15s ease;
        transform-box: fill-box;
        transform-origin: center;
        cursor: pointer;
      }
      .marker.hl {
        transform: scale(1.7);
      }
      .marker.focus {
        animation: markerpulse 1s ease-in-out 2;
      }
      @keyframes markerpulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(2); }
      }
      @media (prefers-reduced-motion: reduce) {
        .card.focus,
        .crate.focus,
        .journal .entry.focus,
        .marker.focus,
        .task-status .pulse {
          animation: none;
        }
      }
    `;

    declare model: WayfinderMap;
    declare theme: ExpeditionTheme;
    declare entries: FlowViewPropsEntries;
    declare workflowDefs: readonly WorkflowDefResponse[];
    declare persistedOutputs: Readonly<Record<string, string>>;
    declare persistedOutputDirs: Readonly<
      Record<string, Readonly<Record<string, string>>>
    >;
    declare hoverId: string | undefined;
    declare focusId: string | undefined;
    declare fogOrder: string[];
    declare openDecisionId: string | undefined;
    declare onAction: ((id: string, actionId: string) => void) | undefined;
    declare onSendMessage:
      | ((id: string, content: string) => Promise<void>)
      | undefined;
    declare onHover: ((id: string | undefined) => void) | undefined;
    declare onFocus: ((id: string) => void) | undefined;
    declare onFogOrderChange: ((order: string[]) => void) | undefined;
    declare onViewChange: ((view: WayfinderView) => void) | undefined;

    // The fog card currently being dragged — deliberately not a reactive
    // property (a re-render on dragstart would cancel the drag).
    private draggedFogId: string | undefined;

    // The hl/focus class suffix shared by every card-family surface.
    private hotClass(id: string): string {
      if (this.focusId === id) return " hl focus";
      if (this.hoverId === id) return " hl";
      return "";
    }

    // Enter/Space focus an element the same way a click does; focus/blur
    // already mirror hover through the @focus/@blur listeners.
    private focusFromKey(event: KeyboardEvent, id: string) {
      if (event.key === "Enter" || event.key === " ") this.onFocus?.(id);
    }

    // Journal drill-in: one closed ticket's decision record open at a time.
    // Opening focuses the entry (map highlight + pulse); the record stays
    // open after the pulse clears, until a click (or Enter/Space) collapses
    // it or opens another.
    private toggleDecision(id: string) {
      this.openDecisionId = this.openDecisionId === id ? undefined : id;
      this.onFocus?.(id);
    }

    // Enter/Space on a journal entry toggles its record open, matching the
    // click affordance for keyboard users; Space must not scroll the column.
    private decisionFromKey(event: KeyboardEvent, id: string) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.toggleDecision(id);
      }
    }

    private onFogDragStart(event: DragEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const card = target.closest(".fog-card");
      if (card === null) return;
      const id = card.getAttribute("data-id");
      if (id === null) return;
      this.draggedFogId = id;
      card.classList.add("dragging");
      event.dataTransfer?.setData?.("text/plain", id);
    }

    private onFogDragOver(event: DragEvent) {
      event.preventDefault();
    }

    // On drop, the dragged id re-enters before the first remaining card whose
    // vertical middle sits below the pointer, and the shell reports the new
    // clear order upward for the entry to persist.
    private onFogDrop(event: DragEvent) {
      event.preventDefault();
      if (this.draggedFogId === undefined) return;
      const pile = event.currentTarget;
      if (!(pile instanceof Element)) return;
      const remaining = [...pile.querySelectorAll(".fog-card")]
        .filter((card) => card.getAttribute("data-id") !== this.draggedFogId)
        .map((card) => {
          const rect = card.getBoundingClientRect();
          return {
            id: card.getAttribute("data-id") ?? "",
            middle: rect.top + rect.height / 2,
          };
        });
      const order = fogDropOrder(this.draggedFogId, remaining, event.clientY);
      this.onFogOrderChange?.(order);
    }

    private onFogDragEnd(event: DragEvent) {
      const pile = event.currentTarget;
      if (pile instanceof Element) {
        for (const card of pile.querySelectorAll(".fog-card.dragging")) {
          card.classList.remove("dragging");
        }
      }
      this.draggedFogId = undefined;
    }

    render() {
      if (this.model === undefined) return nothing;
      const theme = this.theme;
      return html`<div class="table">
          <div class="column left">
            ${this.renderBaseCamp()} ${this.renderBriefingDeck()}
            ${this.renderFogTray()} ${this.renderOnExpedition()}
          </div>
          <div class="column center">${this.renderMapCard(theme)}</div>
          <div class="column right">
            ${this.renderJournal()} ${this.renderDepot()}
            ${this.renderOutOfScope()}
          </div>
        </div>`;
    }

    // A base-camp card for each charting instance: the destination plus the
    // current session's actions (Done/Cancel for naming and frontier).
    private renderBaseCamp() {
      const charting = this.entries.filter(
        (entry) => entry.workflowId === "charting"
      );
      return html`<div class="station">
        <h2 class="station-head">Base camp</h2>
        <div class="pile">
          ${charting.map((entry, index) => {
            const destination = entry.state.workflowInstanceState.destination;
            return html`<div
              class="card${this.hotClass("base")}"
              style=${`--rot:${cardRotation(index)}`}
              data-id="base"
              tabindex="0"
              @mouseenter=${() => this.onHover?.("base")}
              @mouseleave=${() => this.onHover?.(undefined)}
              @focus=${() => this.onHover?.("base")}
              @blur=${() => this.onHover?.(undefined)}
              @click=${() => this.onFocus?.("base")}
              @keydown=${(event: KeyboardEvent) =>
                this.focusFromKey(event, "base")}
            >
              <div class="lbl">${entry.state.currentState}</div>
              <div class="card-title">${
                typeof destination === "string" && destination !== ""
                  ? destination
                  : "Base camp"
              }</div>
              ${this.renderActions(entry)} ${this.renderChat(entry)}
            </div>`;
          })}
          ${
            charting.length === 0
              ? html`<div class="empty">No base camp yet.</div>`
              : nothing
          }
        </div>
      </div>`;
    }

    // Tickets actively being resolved (research, prototype, grilling, task,
    // recording) — the ascent in flight — with their state actions.
    private renderOnExpedition() {
      const resolving = this.entries.filter(
        (entry) =>
          entry.workflowId === "ticket" &&
          RESOLVING_STATES.includes(entry.state.currentState)
      );
      return html`<div class="station">
        <h2 class="station-head">On expedition</h2>
        <div class="pile">
          ${resolving.map((entry, index) => {
            const id = entry.id;
            return html`<div
              class="card${this.hotClass(id)}"
              style=${`--rot:${cardRotation(index)}`}
              data-id=${id}
              tabindex="0"
              @mouseenter=${() => this.onHover?.(id)}
              @mouseleave=${() => this.onHover?.(undefined)}
              @focus=${() => this.onHover?.(id)}
              @blur=${() => this.onHover?.(undefined)}
              @click=${() => this.onFocus?.(id)}
              @keydown=${(event: KeyboardEvent) => this.focusFromKey(event, id)}
            >
              <div class="lbl">${resolvingLabel(entry.state.currentState)}</div>
              <div class="card-title">${ticketTitle(entry)}</div>
              ${this.renderTaskStatus(entry)} ${this.renderTaskError(entry)}
              ${this.renderActions(entry)} ${this.renderChat(entry)}
            </div>`;
          })}
          ${
            resolving.length === 0
              ? html`<div class="empty">Nothing in flight.</div>`
              : nothing
          }
        </div>
      </div>`;
    }

    // The live agent progress for an AFK task (research/prototype/grilling):
    // the model status is pushed into runningTaskContext as the call moves
    // routing -> dispatched -> thinking -> streaming, so the card shows the
    // agent is alive instead of looking frozen while upstream retries.
    private renderTaskStatus(entry: FlowViewPropsEntries[number]) {
      const state = entry.state;
      if (!state.hasRunningTask || state.runningTaskContext === null) {
        return nothing;
      }
      const ctx = state.runningTaskContext;
      if (ctx.role !== "ai-task") return nothing;
      const label = modelStatusLabel(ctx.modelStatus);
      return html`<div class="task-status">
        <span class="pulse"></span>
        <span>${label}</span>
      </div>`;
    }

    // The last agent failure: an errored resolution task (research or one of
    // the chat sessions) leaves its error in taskOutputs, so the card names
    // the reason the run stopped (the retry action sits right below).
    private renderTaskError(entry: FlowViewPropsEntries[number]) {
      if (entry.state.hasRunningTask) return nothing;
      for (const taskId of TICKET_RESOLUTION_TASKS) {
        const outcome = entry.state.taskOutputs[taskId];
        if (outcome !== undefined && outcome.status === "error") {
          const error = readOutcomeError(outcome);
          return html`<div class="task-error">${error}</div>`;
        }
      }
      return nothing;
    }

    // A workflow instance's available state actions (everything is data — the
    // labels and ids come from the entry's availableActions, never hardcoded).
    private renderActions(entry: FlowViewPropsEntries[number]) {
      if (entry.availableActions.length === 0) return nothing;
      return html`<div class="card-actions">
        ${entry.availableActions.map(
          (action) => html`<button
            class=${action.variant}
            type="button"
            @click=${() => this.onAction?.(entry.id, action.id)}
          >
            ${action.label}
          </button>`
        )}
      </div>`;
    }

    // The live interactive session (naming, frontier, grilling, prototype,
    // task, specing), composed through the default <chat-session> element.
    private renderChat(entry: FlowViewPropsEntries[number]) {
      const state = entry.state;
      if (!state.hasRunningTask || state.runningTaskContext === null) {
        return nothing;
      }
      const ctx = state.runningTaskContext;
      if (ctx.role !== "ai-chat" || ctx.interactive !== true) return nothing;
      const workflowDef = this.workflowDefs.find(
        (def) => def.id === entry.workflowId
      );
      const stateDef = workflowDef?.states.find(
        (workflowState) => workflowState.id === state.currentState
      );
      return html`<div class="card-chat">
        <div class="session-header">
          <span class="session-label"
            >${stateDef?.label ?? state.currentState}</span
          >
        </div>
        <chat-session
          .messages=${ctx.messages}
          .sessionId=${ctx.sessionId}
          .interactive=${ctx.interactive}
          .thinking=${agentIsThinking(ctx.messages)}
          .modelStatus=${ctx.modelStatus}
          @hive-send-message=${(event: CustomEvent<{ content: string }>) => {
            this.onSendMessage?.(entry.id, event.detail.content);
          }}
        ></chat-session>
      </div>`;
    }

    private renderBriefingDeck() {
      const dossiers = this.readyDossiers();
      return html`<div class="station">
        <h2 class="station-head">The briefing deck</h2>
        <div class="pile">
          ${dossiers.map((dossier, index) =>
            this.renderDossierCard(dossier, index)
          )}
          ${
            dossiers.length === 0
              ? html`<div class="empty">No claimable tickets yet.</div>`
              : nothing
          }
        </div>
      </div>`;
    }

    // The briefing deck's ready tickets, split by the shared presentation
    // model's derived status: a ready ticket whose dependsOn blockers are all
    // closed is the actionable frontier; a ready ticket with an unresolved
    // blocker presents as blocked. Presentation only — the canonical
    // WorkflowItem state stays `ready`, and the workflow's declared columns
    // and states are untouched.
    private readyDossiers(): Array<{
      entry: FlowViewPropsEntries[number];
      blocked: boolean;
    }> {
      const entriesById = new Map(
        this.entries.map((entry) => [entry.id, entry])
      );
      const dossiers: Array<{
        entry: FlowViewPropsEntries[number];
        blocked: boolean;
      }> = [];
      for (const node of this.model.nodes) {
        if (
          node.presentation !== "frontier" &&
          node.presentation !== "blocked"
        ) {
          continue;
        }
        const entry = entriesById.get(node.id);
        if (entry === undefined) continue;
        dossiers.push({ entry, blocked: node.presentation === "blocked" });
      }
      return dossiers;
    }

    private renderDossierCard(
      dossier: {
        entry: FlowViewPropsEntries[number];
        blocked: boolean;
      },
      index: number
    ) {
      const entry = dossier.entry;
      const state = entry.state.workflowInstanceState;
      const title = ticketTitle(entry);
      const question =
        typeof state.question === "string" ? state.question : undefined;
      const type = typeof state.type === "string" ? state.type : undefined;
      const id = entry.id;
      const stamp =
        dossier.blocked && type !== undefined
          ? `blocked · ${type}`
          : dossier.blocked
            ? "blocked"
            : type;
      return html`<div
        class="card${dossier.blocked ? " blocked" : ""}${this.hotClass(id)}"
        style=${`--rot:${cardRotation(index)}`}
        data-id=${id}
        tabindex="0"
        @mouseenter=${() => this.onHover?.(id)}
        @mouseleave=${() => this.onHover?.(undefined)}
        @focus=${() => this.onHover?.(id)}
        @blur=${() => this.onHover?.(undefined)}
        @click=${() => this.onFocus?.(id)}
        @keydown=${(event: KeyboardEvent) => this.focusFromKey(event, id)}
      >
        <div class="card-title">${title}</div>
        ${
          question !== undefined && question !== ""
            ? html`<div class="body">${question}</div>`
            : nothing
        }
        ${
          stamp !== undefined
            ? html`<span class="stamp${dossier.blocked ? " blocked" : ""}">${stamp}</span>`
            : nothing
        }
        ${this.renderActions(entry)}
      </div>`;
    }

    private renderFogTray() {
      const fog = inClearOrder(this.ticketsInState("fog"), this.fogOrder);
      return html`<div class="station">
        <h2 class="station-head">The fog tray</h2>
        <div
          class="pile"
          @dragstart=${this.onFogDragStart}
          @dragover=${this.onFogDragOver}
          @drop=${this.onFogDrop}
          @dragend=${this.onFogDragEnd}
        >
          ${fog.map((entry, index) => this.renderFogCard(entry, index))}
          ${
            fog.length === 0
              ? html`<div class="empty">The fog is clear.</div>`
              : nothing
          }
        </div>
      </div>`;
    }

    private renderFogCard(entry: FlowViewPropsEntries[number], index: number) {
      const id = entry.id;
      return html`<div
        class="card fog-card${this.hotClass(id)}"
        style=${`--rot:${cardRotation(index)}`}
        data-id=${id}
        draggable="true"
        tabindex="0"
        @mouseenter=${() => this.onHover?.(id)}
        @mouseleave=${() => this.onHover?.(undefined)}
        @focus=${() => this.onHover?.(id)}
        @blur=${() => this.onHover?.(undefined)}
        @click=${() => this.onFocus?.(id)}
        @keydown=${(event: KeyboardEvent) => this.focusFromKey(event, id)}
      >
        <div class="fog-title"><span class="q">?</span><span class="card-title">${ticketTitle(entry)}</span></div>
        <span class="tag">needs clarity</span>
        ${this.renderActions(entry)}
      </div>`;
    }

    private renderJournal() {
      const closed = this.ticketsInState("closed");
      return html`<div class="station">
        <h2 class="station-head">The journal</h2>
        <div class="journal">
          ${closed.map((entry) => {
            const id = entry.id;
            const record = readDecisionRecord(this.persistedOutputDirs, id);
            return html`<div
              class="entry${this.hotClass(id)}"
              data-id=${id}
              tabindex="0"
              @mouseenter=${() => this.onHover?.(id)}
              @mouseleave=${() => this.onHover?.(undefined)}
              @focus=${() => this.onHover?.(id)}
              @blur=${() => this.onHover?.(undefined)}
              @click=${() => this.toggleDecision(id)}
              @keydown=${(event: KeyboardEvent) =>
                this.decisionFromKey(event, id)}
            >
              <span class="cairn">▴</span>
              <span class="txt">${ticketTitle(entry)}</span>
            </div>
            ${
              this.openDecisionId === id
                ? html`<div class="decision">
                    ${
                      record === undefined
                        ? html`<div class="decision-empty">
                            No decision record persisted.
                          </div>`
                        : html`<markdown-view .content=${record}></markdown-view>`
                    }
                  </div>`
                : nothing
            }`;
          })}
          ${
            closed.length === 0
              ? html`<div class="empty">No decisions recorded yet.</div>`
              : nothing
          }
        </div>
      </div>`;
    }

    private renderDepot() {
      const builds = this.entries.filter(
        (entry) => entry.workflowId === "build"
      );
      const buildItems = this.entries.filter(
        (entry) => entry.workflowId === "buildItem"
      );
      const spec = this.persistedOutputs["spec.md"];
      const plan = this.persistedOutputs["build-plan.md"];
      const hasSpec = spec !== undefined && spec !== "";
      const hasPlan = plan !== undefined && plan !== "";
      const hasAny =
        hasSpec || hasPlan || builds.length > 0 || buildItems.length > 0;
      return html`<div class="station">
        <h2 class="station-head">The supply depot</h2>
        <div class="pile">
          ${
            hasSpec
              ? html`<div class="crate spec">
                <div class="lbl">manifest · spec</div>
                <div class="card-title">${firstLine(spec ?? "")}</div>
              </div>`
              : nothing
          }
          ${
            hasPlan
              ? html`<div class="crate">
                <div class="lbl">route plan</div>
                <div class="card-title">${firstLine(plan ?? "")}</div>
              </div>`
              : nothing
          }
          ${builds.map((entry, index) => {
            const id = entry.id;
            return html`<div
              class="crate${this.hotClass(id)}"
              style=${`--rot:${cardRotation(index)}`}
              data-id=${id}
              tabindex="0"
              @mouseenter=${() => this.onHover?.(id)}
              @mouseleave=${() => this.onHover?.(undefined)}
              @focus=${() => this.onHover?.(id)}
              @blur=${() => this.onHover?.(undefined)}
              @click=${() => this.onFocus?.(id)}
              @keydown=${(event: KeyboardEvent) => this.focusFromKey(event, id)}
            >
              <div class="lbl">build · ${entry.state.currentState}</div>
              <div class="card-title">The implementation phase</div>
              ${this.renderActions(entry)} ${this.renderChat(entry)}
            </div>`;
          })}
          ${buildItems.map((entry, index) => {
            const id = entry.id;
            return html`<div
              class="crate${this.hotClass(id)}"
              style=${`--rot:${cardRotation(index)}`}
              data-id=${id}
              tabindex="0"
              @mouseenter=${() => this.onHover?.(id)}
              @mouseleave=${() => this.onHover?.(undefined)}
              @focus=${() => this.onHover?.(id)}
              @blur=${() => this.onHover?.(undefined)}
              @click=${() => this.onFocus?.(id)}
              @keydown=${(event: KeyboardEvent) => this.focusFromKey(event, id)}
            >
              <div class="lbl">gear · build item</div>
              <div class="card-title">${implementationTitle(entry)}</div>
              ${this.renderActions(entry)}
            </div>`;
          })}
          ${
            hasAny
              ? nothing
              : html`<div class="empty">No supplies yet — start a build.</div>`
          }
        </div>
      </div>`;
    }

    private renderOutOfScope() {
      const outOfScope = this.ticketsInState("out_of_scope");
      return html`<div class="station">
        <h2 class="station-head">Do not enter</h2>
        <div class="pile">
          ${outOfScope.map((entry) => {
            const id = entry.id;
            return html`<div
              class="card${this.hotClass(id)}"
              data-id=${id}
              tabindex="0"
              @mouseenter=${() => this.onHover?.(id)}
              @mouseleave=${() => this.onHover?.(undefined)}
              @focus=${() => this.onHover?.(id)}
              @blur=${() => this.onHover?.(undefined)}
              @click=${() => this.onFocus?.(id)}
              @keydown=${(event: KeyboardEvent) => this.focusFromKey(event, id)}
            >
              <div class="card-title">⊘ ${ticketTitle(entry)}</div>
              <span class="stamp">ruled out</span>
            </div>`;
          })}
          ${
            outOfScope.length === 0
              ? html`<div class="empty">Nothing ruled out.</div>`
              : nothing
          }
        </div>
      </div>`;
    }

    private renderMapCard(theme: ExpeditionTheme) {
      return html`<div class="map-card">
        <div class="map-top">
          <div class="dest-note">
            <div class="name">${this.model.destination}</div>
            <div class="sub">Destination</div>
          </div>
          <button class="open-map" type="button" @click=${() => this.onViewChange?.("map")}>
            Open the map view →
          </button>
        </div>
        ${this.miniMap(theme)}
      </div>`;
    }

    private miniMap(theme: ExpeditionTheme) {
      const glyphs = THEME_GLYPHS[theme];
      const accent = THEME_ACCENT[theme];
      const sx = 5.6;
      const sy = 4;
      const summit = this.model.nodes.find(
        (node) => node.presentation === "summit"
      );
      return svg`<svg viewBox="0 0 560 400" role="img" aria-label="Expedition map">
        ${drawing.drawBackdrop(this.model.nodes, theme, sx, sy)}
        ${drawing.drawFrontier(this.model.nodes, sx, sy, accent)}
        ${drawing.drawTrail(this.model.nodes, sx, sy, accent)}
        ${
          summit !== undefined
            ? svg`<text
                x=${summit.x * sx}
                y=${summit.y * sy - 6}
                text-anchor="middle"
                font-size="20"
                fill=${accent}
              >${glyphs.summit}</text>`
            : nothing
        }
        ${this.model.nodes
          .filter(
            (node) =>
              node.presentation !== "base" && node.presentation !== "summit"
          )
          .map((node) => {
            const id = node.id;
            return drawing.drawMarker(node, sx, sy, theme, {
              className: `marker${this.hotClass(id)}`,
              onEnter: () => this.onHover?.(id),
              onLeave: () => this.onHover?.(undefined),
              onClick: () => this.onFocus?.(id),
              onFocus: () => this.onHover?.(id),
              onBlur: () => this.onHover?.(undefined),
              onKeydown: (event) => this.focusFromKey(event, id),
            });
          })}
      </svg>`;
    }

    private ticketsInState(state: string) {
      return this.entries.filter(
        (entry) =>
          entry.workflowId === "ticket" && entry.state.currentState === state
      );
    }
  }

  return WayfinderTable;
}

// Cards on the table sit at alternating small rotations (papers laid on a
// desk) — the sign flips per index so neighbours tilt opposite ways.
function cardRotation(index: number): string {
  const magnitude = 0.4 + ((index * 3) % 4) * 0.3;
  return `${index % 2 === 0 ? -magnitude : magnitude}deg`;
}

// The live model-call stage, human-readable for the card's status line.
function modelStatusLabel(status: ModelCallStatus | undefined): string {
  switch (status?.stage) {
    case "dispatched":
      return `researching via ${status.provider} · ${status.model}`;
    case "thinking":
      return "thinking…";
    case "streaming":
      return "writing the report…";
    case "complete":
      return "finalizing…";
    case "error":
      return `research error: ${status.message}`;
    default:
      return "routing the research call…";
  }
}

// The first non-empty line of a markdown file, for the depot crates' titles.
function firstLine(text: string): string {
  const first = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "");
  return first ?? text.slice(0, 60);
}

// Orders the fog tickets by the stored clear-order id list; entries absent
// from the list keep their natural relative order. The list is session-local
// — it survives re-renders and persists in sessionStorage keyed by flow id.
function inClearOrder<T extends { id: string }>(
  items: readonly T[],
  order: readonly string[]
): T[] {
  const rank = new Map<string, number>();
  order.forEach((id, index) => {
    rank.set(id, index);
  });
  return [...items].sort((a, b) => {
    const ar = rank.get(a.id);
    const br = rank.get(b.id);
    if (ar === undefined && br === undefined) return 0;
    if (ar === undefined) return 1;
    if (br === undefined) return -1;
    return ar - br;
  });
}

// The new clear order after a fog drop: the dragged id re-enters before the
// first remaining card whose vertical middle sits below the pointer, or at
// the pile's end when the drop lands past every card.
function fogDropOrder(
  draggedId: string,
  remaining: ReadonlyArray<{ id: string; middle: number }>,
  dropY: number
): string[] {
  const rest = remaining.map((card) => card.id);
  const before = remaining.find((card) => dropY < card.middle);
  const at = before === undefined ? rest.length : rest.indexOf(before.id);
  const next = [...rest];
  next.splice(at, 0, draggedId);
  return next;
}
