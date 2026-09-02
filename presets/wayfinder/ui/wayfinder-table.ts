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
import {
  cardRotation,
  firstLine,
  fogDropOrder,
  inClearOrder,
  modelStatusLabel,
} from "./wayfinder-table/helpers.ts";
import { wayfinderTableStyles } from "./wayfinder-table/styles.ts";
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

    static styles = wayfinderTableStyles(css);

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
