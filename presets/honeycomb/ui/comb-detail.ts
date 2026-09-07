/** The detail flip (served component "comb-detail"): click a cell and it
 * flips in place and enlarges — a hexagon that grows out of the comb into
 * its detail face, visually part of the map, never a detached modal. The
 * entrance is a CSS ANIMATION (not a class-toggled transition): it plays
 * whenever the .detail element is created — every open — and a lit
 * re-render reuses the mounted element without restarting it, so snapshot
 * churn never replays the entrance and every open flips for real. The
 * animation drives all three axes at once: the hexagon flies from the
 * clicked cell's screen position (--from-x/--from-y, relative to the
 * resting center) to the viewport center, grows, and the inner wrapper
 * rotates (rotateY) from a mini honey-cell front face to the detail back
 * face — perspective 3D, backface-hidden faces.
 *
 * The detail face carries everything the standard card would: summary, the
 * editable fields (status/priority/effort/category via onPatchState, tags
 * as a comma list), the original notes (collapsed), and the state actions
 * (Mark done / Park / Discard via onAction). The scrim click and the ✕
 * both close. Routing to the standard workflow-instance page is not wired
 * yet (the host's hive-select seam is a no-op until a dedicated instance
 * page exists) — the affordance returns when that seam lands. */

import type { FlowComponentDeps } from "workflow-engine/workflow-types";
import type { WorldPoint } from "./hex-layout.ts";
import type { CombCell } from "./shared.ts";

// The select options the ideas workflow declares on its editFields. This
// IS honeycomb's data mapping, so the vocabularies live here.
const STATUS_OPTIONS = ["backlog", "in-progress", "blocked", "done", "parked"];
const PRIORITY_OPTIONS = ["p0", "p1", "p2", "p3", "p4"];
const EFFORT_OPTIONS = ["S", "M", "L", "XL"];

export type CombDetailElement = HTMLElement & {
  cell: CombCell | undefined;
  // The clicked cell's screen position — the point the entrance animation
  // grows out of. Undefined → the hexagon simply rises from the center.
  origin: WorldPoint | undefined;
  // The category options (the hive labels) for the category select.
  hiveLabels: readonly string[];
  onPatchState:
    | ((instanceId: string, values: Record<string, unknown>) => void)
    | undefined;
  onAction: ((instanceId: string, actionId: string) => void) | undefined;
  onClose: (() => void) | undefined;
};

export function createCombDetail(
  lit: FlowComponentDeps
): new () => CombDetailElement {
  const { LitElement: Base, html, css, nothing } = lit;

  class CombDetail extends Base {
    static properties = {
      cell: { attribute: false },
      origin: { attribute: false },
      hiveLabels: { attribute: false },
      onPatchState: { attribute: false },
      onAction: { attribute: false },
      onClose: { attribute: false },
    };

    static styles = css`
      :host {
        position: absolute;
        inset: 0;
        pointer-events: none;
        font-family: var(--hc-font, system-ui, sans-serif);
      }
      .scrim {
        position: absolute;
        inset: 0;
        pointer-events: auto;
        background: color-mix(in srgb, #0d0800 55%, transparent);
        animation: comb-fade 0.35s ease both;
      }
      @keyframes comb-fade {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      .detail {
        position: absolute;
        left: 50%;
        top: 50%;
        /* The detail box is a square, the hexagon is clipped inside it —
           so the container and the flip wrapper must not intercept clicks;
           the faces (hexagon-clipped, which also shapes their hit area)
           re-enable pointer events, and clicks in the clipped-away corners
           fall through to the scrim and close. */
        pointer-events: none;
        perspective: 1200px;
        /* The entrance is an animation, not a class-toggled transition:
           it plays on element creation (every open) and the fill-mode keeps
           the resting state. The same idea arriving as a refreshed object
           reuses the mounted element — no restart, no stutter. */
        animation: comb-open 0.55s cubic-bezier(0.2, 0.9, 0.25, 1) both;
      }
      @keyframes comb-open {
        from {
          transform: translate(
              calc(-50% + var(--from-x, 0px)),
              calc(-50% + var(--from-y, 0px))
            )
            scale(0.18);
        }
        to {
          transform: translate(-50%, -50%) scale(1);
        }
      }
      .flip {
        width: 100%;
        height: 100%;
        position: relative;
        transform-style: preserve-3d;
        animation: comb-flip 0.55s cubic-bezier(0.3, 0.8, 0.3, 1) both;
      }
      @keyframes comb-flip {
        from {
          transform: rotateY(0deg);
        }
        to {
          transform: rotateY(180deg);
        }
      }
      .face {
        position: absolute;
        inset: 0;
        pointer-events: auto;
        backface-visibility: hidden;
        clip-path: polygon(75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%, 25% 0%);
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }
      /* The hexagon "border": a clipped element cannot carry a real border
         or box-shadow (the corners cut it), so the face's own background is
         the edge color and the inset fill shows the surface beneath. */
      .face.front {
        background: var(--honey-edge, #b97a10);
      }
      .face.front .face-fill {
        position: absolute;
        inset: 3px;
        clip-path: polygon(75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%, 25% 0%);
        background: var(--honey, #e8a020);
      }
      .face.front .cell-title {
        position: relative;
        font-size: clamp(11px, 2.2vw, 16px);
        line-height: 1.3;
        color: var(--hc-ink, #f4e9d0);
        padding: 0 16%;
        text-align: center;
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 4;
        -webkit-box-orient: vertical;
      }
      .face.back {
        transform: rotateY(180deg);
        background: var(--wax-edge, #4a3618);
      }
      .face.back .face-fill {
        position: absolute;
        inset: 3px;
        clip-path: polygon(75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%, 25% 0%);
        background: var(--hc-paper, #241a0c);
        overflow: hidden;
      }
      .back-scroll {
        position: absolute;
        inset: 0;
        overflow: auto;
        padding: 14% 20%;
        box-sizing: border-box;
        color: var(--hc-ink, #f4e9d0);
      }
      .back-head {
        display: flex;
        align-items: flex-start;
        gap: 8px;
      }
      .back-head h2 {
        margin: 0;
        font-size: 1.05em;
        line-height: 1.3;
        flex: 1;
        word-break: break-word;
      }
      .close {
        flex: none;
        border: none;
        background: none;
        color: var(--hc-body, #b39b72);
        font-size: 1.1em;
        cursor: pointer;
        padding: 2px 4px;
      }
      .close:hover {
        color: var(--hc-ink, #f4e9d0);
      }
      .chip {
        display: inline-block;
        font-size: 0.72em;
        font-weight: 650;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--tint, #e8a020);
        border: 1px solid color-mix(in srgb, var(--tint, #e8a020) 55%, transparent);
        border-radius: 999px;
        padding: 1px 9px;
        margin: 6px 0 2px;
      }
      .summary {
        font-size: 0.86em;
        line-height: 1.5;
        color: var(--hc-body, #cbb990);
        margin: 6px 0 10px;
        white-space: pre-wrap;
      }
      .field-row {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 4px 10px;
        align-items: center;
        font-size: 0.8em;
        margin: 8px 0;
      }
      .field-row label {
        color: var(--hc-body, #b39b72);
        font-weight: 600;
      }
      .field-row select,
      .field-row input {
        font: inherit;
        font-size: 0.95em;
        color: var(--hc-ink, #f4e9d0);
        background: var(--hc-field, #1d1409);
        border: 1px solid var(--hc-edge, #3d2c14);
        border-radius: 7px;
        padding: 4px 8px;
        min-width: 0;
      }
      .tags {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin: 2px 0 8px;
      }
      .tag {
        font-size: 0.7em;
        background: var(--hc-field, #1d1409);
        border: 1px solid var(--hc-edge, #3d2c14);
        color: var(--hc-body, #cbb990);
        border-radius: 999px;
        padding: 1px 9px;
      }
      details.original {
        font-size: 0.78em;
        color: var(--hc-body, #b39b72);
        margin: 10px 0;
      }
      details.original summary {
        cursor: pointer;
        font-weight: 600;
      }
      details.original p {
        white-space: pre-wrap;
        line-height: 1.5;
        margin: 6px 0 0;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 12px;
      }
      .actions button {
        font: inherit;
        font-size: 0.78em;
        padding: 5px 12px;
        border-radius: 999px;
        cursor: pointer;
        border: 1px solid var(--hc-edge, #3d2c14);
        background: var(--hc-field, #1d1409);
        color: var(--hc-ink, #f4e9d0);
      }
      .actions button.primary {
        background: var(--honey, #e8a020);
        border-color: var(--honey-edge, #b97a10);
        color: #241a0c;
        font-weight: 650;
      }
      .actions button.destructive {
        color: #e8a020;
        border-color: color-mix(in srgb, #d06540 60%, transparent);
      }
      .actions button:hover {
        filter: brightness(1.15);
      }
      @media (max-width: 700px) {
        .back-scroll {
          padding: 20% 24%;
        }
      }
    `;

    declare cell: CombCell | undefined;
    declare origin: WorldPoint | undefined;
    declare hiveLabels: readonly string[];
    declare onPatchState:
      | ((instanceId: string, values: Record<string, unknown>) => void)
      | undefined;
    declare onAction:
      | ((instanceId: string, actionId: string) => void)
      | undefined;
    declare onClose: (() => void) | undefined;

    constructor() {
      super();
      this.cell = undefined;
      this.origin = undefined;
      this.hiveLabels = [];
    }

    private patch(values: Record<string, unknown>): void {
      const cell = this.cell;
      if (cell === undefined) return;
      this.onPatchState?.(cell.id, values);
    }

    private act(actionId: string): void {
      const cell = this.cell;
      if (cell === undefined) return;
      this.onAction?.(cell.id, actionId);
      this.onClose?.();
    }

    private onTagsInput(event: Event): void {
      const input = event.target;
      if (!(input instanceof HTMLInputElement)) return;
      const tags = input.value
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag !== "");
      this.patch({ tags });
    }

    render() {
      const cell = this.cell;
      if (cell === undefined) return nothing;
      const origin = this.origin;
      // The hexagon's screen size: generous but never taller than the
      // viewport (the flat-top bounding box is 2s wide by √3·s tall). The
      // element rests centered (left/top 50%); the entrance animation
      // carries it from the clicked cell's screen position via the
      // --from-x/--from-y offsets.
      const height = Math.min(this.clientHeight * 0.82, 560);
      const width = (height * 2) / Math.sqrt(3);
      const fromX = (origin?.x ?? this.clientWidth / 2) - this.clientWidth / 2;
      const fromY =
        (origin?.y ?? this.clientHeight / 2) - this.clientHeight / 2;
      const entry = cell.entry;
      const actions = entry.availableActions;
      const categoryOptions = [...new Set([cell.category, ...this.hiveLabels])];
      return html`
        <div class="scrim" @click=${() => this.onClose?.()}></div>
        <div
          class="detail"
          data-cell=${cell.id}
          style=${`width:${width}px;height:${height}px;--from-x:${fromX}px;--from-y:${fromY}px`}
        >
          <div class="flip">
            <div class="face front status-${cell.status}">
              <div class="face-fill"></div>
              <span class="cell-title">${cell.title}</span>
            </div>
            <div class="face back">
              <div class="face-fill">
                <div class="back-scroll">
                <div class="back-head">
                  <h2>${cell.title}</h2>
                  <button class="close" @click=${() => this.onClose?.()}>✕</button>
                </div>
                <span class="chip">${cell.category}</span>
                <p class="summary">${cell.summary ?? "No summary yet."}</p>
                <div class="field-row">
                  <label for="hc-status">Status</label>
                  <select
                    id="hc-status"
                    .value=${cell.status}
                    @change=${(e: Event) =>
                      this.patch({
                        status: (e.target as HTMLSelectElement).value,
                      })}
                  >
                    ${STATUS_OPTIONS.map(
                      (option) =>
                        html`<option value=${option}>${option}</option>`
                    )}
                  </select>
                  <label for="hc-category">Category</label>
                  <select
                    id="hc-category"
                    .value=${cell.category}
                    @change=${(e: Event) =>
                      this.patch({
                        category: (e.target as HTMLSelectElement).value,
                      })}
                  >
                    ${categoryOptions.map(
                      (option) =>
                        html`<option value=${option}>${option}</option>`
                    )}
                  </select>
                  <label for="hc-priority">Priority</label>
                  <select
                    id="hc-priority"
                    .value=${cell.priority ?? ""}
                    @change=${(e: Event) =>
                      this.patch({
                        priority: (e.target as HTMLSelectElement).value,
                      })}
                  >
                    <option value="">—</option>
                    ${PRIORITY_OPTIONS.map(
                      (option) =>
                        html`<option value=${option}>${option}</option>`
                    )}
                  </select>
                  <label for="hc-effort">Effort</label>
                  <select
                    id="hc-effort"
                    .value=${cell.effort ?? ""}
                    @change=${(e: Event) =>
                      this.patch({
                        effort: (e.target as HTMLSelectElement).value,
                      })}
                  >
                    <option value="">—</option>
                    ${EFFORT_OPTIONS.map(
                      (option) =>
                        html`<option value=${option}>${option}</option>`
                    )}
                  </select>
                </div>
                <div class="tags">
                  ${cell.tags.map((tag) => html`<span class="tag">${tag}</span>`)}
                </div>
                <div class="field-row">
                  <label for="hc-tags">Tags</label>
                  <input
                    id="hc-tags"
                    .value=${cell.tags.join(", ")}
                    placeholder="comma, separated, tags"
                    @change=${(e: Event) => this.onTagsInput(e)}
                  />
                </div>
                ${
                  cell.originalText !== undefined
                    ? html`<details class="original">
                      <summary>Original notes</summary>
                      <p>${cell.originalText}</p>
                    </details>`
                    : nothing
                }
                ${
                  actions.length > 0
                    ? html`<div class="actions">
                      ${actions.map(
                        (action) => html`
                          <button
                            class=${action.variant}
                            @click=${() => this.act(action.id)}
                          >
                            ${action.label}
                          </button>
                        `
                      )}
                    </div>`
                    : nothing
                }
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    }
  }

  return CombDetail;
}
