/** The empty comb (served component "comb-empty"): the minimal empty state
 * — a faint placeholder cluster of hexagons and one clear call to action.
 * Import notes is the flow's lifeblood; the empty state's whole job is to
 * invite the first paste. */

import type { FlowComponentDeps } from "workflow-engine/workflow-types";
export type CombEmptyElement = HTMLElement & {
  flowLabel: string;
  onImport: (() => void) | undefined;
};

// The placeholder cluster: seven faint hexagons in a ring — the comb
// waiting to be filled. Axial coordinates on a flat-top grid; the render
// converts them with the shared flat-top pitch (x = 1.5·s·q,
// y = √3·s·(q/2 + r)).
const PLACEHOLDER_CELLS: readonly { q: number; r: number; s: number }[] = [
  { q: 0, r: 0, s: 1 },
  { q: 1, r: 0, s: 0.9 },
  { q: 0, r: 1, s: 0.9 },
  { q: -1, r: 1, s: 0.9 },
  { q: -1, r: 0, s: 0.9 },
  { q: 0, r: -1, s: 0.9 },
  { q: 1, r: -1, s: 0.9 },
];

export function createCombEmpty(
  lit: FlowComponentDeps
): new () => CombEmptyElement {
  const { LitElement: Base, html, css } = lit;

  class CombEmpty extends Base {
    static properties = {
      flowLabel: { attribute: false },
      onImport: { attribute: false },
    };

    static styles = css`
      :host {
        flex: 1;
        min-height: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: var(--hc-font, system-ui, sans-serif);
        color: var(--hc-ink, #f4e9d0);
      }
      .camp {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 18px;
        text-align: center;
        padding: 24px;
      }
      .cluster {
        position: relative;
        width: 300px;
        height: 260px;
      }
      .ghost {
        position: absolute;
        clip-path: polygon(75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%, 25% 0%);
        background: var(--wax-edge, #4a3618);
        opacity: 0.55;
        animation: breathe 3.2s ease-in-out infinite;
      }
      .ghost .fill {
        position: absolute;
        inset: 2px;
        clip-path: polygon(75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%, 25% 0%);
        background: var(--wax-empty, #2a1e0e);
      }
      .ghost:nth-child(2n) {
        animation-delay: -1.6s;
      }
      .ghost:nth-child(3n) {
        animation-delay: -0.8s;
      }
      @keyframes breathe {
        0%,
        100% {
          opacity: 0.4;
        }
        50% {
          opacity: 0.7;
        }
      }
      h1 {
        margin: 0;
        font-size: 1.25rem;
        font-weight: 650;
        letter-spacing: 0.01em;
      }
      p {
        margin: 0;
        max-width: 40ch;
        color: var(--hc-body, #b39b72);
        font-size: 0.9rem;
        line-height: 1.5;
      }
      button {
        font: inherit;
        font-size: 0.9rem;
        font-weight: 650;
        padding: 9px 20px;
        border-radius: 999px;
        border: 1px solid var(--honey-edge, #b97a10);
        background: var(--honey, #e8a020);
        color: #241a0c;
        cursor: pointer;
      }
      button:hover {
        filter: brightness(1.12);
      }
    `;

    declare flowLabel: string;
    declare onImport: (() => void) | undefined;

    constructor() {
      super();
      this.flowLabel = "";
    }

    render() {
      // The placeholder hexagons on the flat-top axial grid, sized against
      // the cluster box (unit = the cell circumradius; boxes are 2s × √3·s).
      const unit = 54;
      const SQRT3 = Math.sqrt(3);
      const clusterWidth = 300;
      const clusterHeight = 260;
      return html`
        <div class="camp">
          <div class="cluster">
            ${PLACEHOLDER_CELLS.map((cell) => {
              const width = 2 * cell.s * unit;
              const height = SQRT3 * cell.s * unit;
              const x = 1.5 * cell.s * unit * cell.q;
              const y = SQRT3 * cell.s * unit * (cell.q / 2 + cell.r);
              return html`<div
                class="ghost"
                style=${`left:${clusterWidth / 2 + x - width / 2}px;top:${clusterHeight / 2 + y - height / 2}px;width:${width}px;height:${height}px`}
              ><div class="fill"></div></div>`;
            })}
          </div>
          <h1>${this.flowLabel || "Honeycomb"}</h1>
          <p>The comb is empty. Paste a raw idea dump — the hive splits it, classifies every idea, and the hexagons fill in.</p>
          <button @click=${() => this.onImport?.()}>Import notes</button>
        </div>
      `;
    }
  }

  return CombEmpty;
}
