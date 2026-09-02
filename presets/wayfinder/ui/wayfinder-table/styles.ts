/** @private — only imported by wayfinder-table.ts: the table workbench's
 * themed CSS — the expedition-desks stations (base camp, briefing deck,
 * fog tray, on-expedition, journal, depot, do-not-enter) around the
 * mini-map centre column. Served modules receive the lit runtime via the
 * factory, so the css tag is passed in rather than imported. */
import type { FlowComponentDeps } from "workflow-engine/workflow-types";

export function wayfinderTableStyles(css: FlowComponentDeps["css"]) {
  return css`
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
  `;
}
