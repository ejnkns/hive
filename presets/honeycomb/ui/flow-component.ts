/** The honeycomb flow component (served component "flow-component"): the
 * flow-level custom view rendering the WHOLE flow-instance page body. The
 * entry is the conductor: it owns the hive theme wrapper (the --hc-* token
 * set — strong honey on warm dark wax, with a light-mode variant), and the
 * one persistent comb shell (comb-shell.ts), which composes the comb
 * surface (the camera + cells), the detail flip, the empty state, the
 * HUD, and the map.md panel. There is no per-workflow fallback layer: if
 * this component fails to load, the generic Hive sections render — the
 * canonical degraded path. */

import type {
  FlowComponentDeps,
  FlowComponentRegistrations,
  FlowViewProps,
} from "workflow-engine/workflow-types";
import { createCombDetail } from "./comb-detail.ts";
import { createCombEmpty } from "./comb-empty.ts";
import { type CombShellElement, createCombShell } from "./comb-shell.ts";
import { createCombSurface } from "./comb-surface.ts";

export default function (lit: FlowComponentDeps): FlowComponentRegistrations {
  const { LitElement: Base, html, css } = lit;
  const Surface = createCombSurface(lit);
  const Detail = createCombDetail(lit);
  const Empty = createCombEmpty(lit);
  const Shell = createCombShell({ lit, Surface, Detail, Empty });

  class FlowComponent extends Base {
    static properties = {
      flow: { attribute: false },
      workflowDefs: { attribute: false },
      entries: { attribute: false },
      customKinds: { attribute: false },
      workflowCounts: { attribute: false },
      availableFlowActions: { attribute: false },
      persistedOutputs: { attribute: false },
      persistedOutputDirs: { attribute: false },
      onAction: { attribute: false },
      onSendMessage: { attribute: false },
      onPatchState: { attribute: false },
      onFlowAction: { attribute: false },
      onCreate: { attribute: false },
    };

    static styles = css`
      :host {
        display: block;
        height: 100%;
      }
      /* The hive chrome: the theme wrapper everything sits inside. The
         --hc-* token set is defined here so the shell (its own shadow
         root) inherits the palette through the DOM. */
      .honeycomb {
        height: 100%;
        display: flex;
        flex-direction: column;
        --honey: #e8a020;
        --honey-edge: #b97a10;
        --honey-crystal: #4a3326;
        --honey-crystal-edge: #a04a2a;
        --hc-paper: #241a0c;
        --hc-field: #1d1409;
        --hc-edge: #3d2c14;
        --hc-ink: #f4e9d0;
        --hc-body: #cbb990;
        --wax-empty: #2a1e0e;
        --wax-edge: #4a3618;
        --hc-comb-backdrop: #191106;
        --hc-font:
          system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial,
          sans-serif;
        font-family: var(--hc-font);
      }
      :host-context(html.light) .honeycomb {
        --honey: #d18a10;
        --honey-edge: #a86d0c;
        --honey-crystal: #6b5236;
        --honey-crystal-edge: #8a4a26;
        --hc-paper: #f6ecd6;
        --hc-field: #efe0bd;
        --hc-edge: #d8c494;
        --hc-ink: #2a2010;
        --hc-body: #6b5a3a;
        --wax-empty: #e8d9b4;
        --wax-edge: #c4ad78;
        --hc-comb-backdrop: #f2e6cc;
      }

      @media (max-width: 900px) {
        .honeycomb {
          height: auto;
        }
      }
    `;

    declare flow: FlowViewProps["flow"];
    declare workflowDefs: FlowViewProps["workflowDefs"];
    declare entries: FlowViewProps["entries"];
    declare customKinds: FlowViewProps["customKinds"];
    declare workflowCounts: FlowViewProps["workflowCounts"];
    declare availableFlowActions: FlowViewProps["availableFlowActions"];
    declare persistedOutputs: FlowViewProps["persistedOutputs"];
    declare persistedOutputDirs: FlowViewProps["persistedOutputDirs"];
    declare onAction: FlowViewProps["onAction"];
    declare onSendMessage: FlowViewProps["onSendMessage"];
    declare onPatchState: FlowViewProps["onPatchState"];
    declare onFlowAction: FlowViewProps["onFlowAction"];
    declare onCreate: FlowViewProps["onCreate"];

    // The one persistent shell: the camera, the detail animation state,
    // and the selection live inside it and survive every re-render.
    private shell: CombShellElement | undefined;

    private ensureShell(): CombShellElement {
      const existing = this.shell;
      if (existing !== undefined) return existing;
      const shell: CombShellElement = new Shell();
      shell.onAction = (id, actionId) => this.onAction(id, actionId);
      shell.onPatchState = (id, values) => this.onPatchState(id, values);
      shell.onCreate = (actionId) => this.onCreate(actionId);
      this.shell = shell;
      return shell;
    }

    protected override updated(changedProperties: Map<string, unknown>): void {
      super.updated(changedProperties);
      const identity = {
        flowLabel: this.flow.label,
        flowStatus: this.flow.status,
      };
      if (this.shell !== undefined) {
        Object.assign(this.shell, {
          ...identity,
          flow: this.flow,
          entries: this.entries,
          persistedOutputs: this.persistedOutputs,
          availableFlowActions: this.availableFlowActions,
        });
      }
    }

    render() {
      return html`<div class="honeycomb">${this.ensureShell()}</div>`;
    }
  }

  return {
    components: {
      "flow-component": FlowComponent,
      "comb-shell": Shell,
      "comb-surface": Surface,
      "comb-detail": Detail,
      "comb-empty": Empty,
    },
  };
}
