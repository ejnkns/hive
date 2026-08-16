/** The "prototype-decision" custom render kind: a prototype/grilling/task
 * session's captured decision — the one-line gist, the decision body, and the
 * artifact path kept as a primary source. Bound on the chat resolution tasks'
 * output in the wayfinder definition. */

import type { LitElement } from "lit";
import type {
  FlowComponentDeps,
  FlowComponentRegistrations,
} from "workflow-engine/workflow-types";

export default function (lit: FlowComponentDeps): FlowComponentRegistrations {
  const { LitElement: Base, html, css, nothing } = lit;

  class PrototypeDecision extends Base {
    static properties = {
      decision: { attribute: false },
      gist: { attribute: false },
      artifactPath: { attribute: false },
    };

    static styles = css`
      :host {
        display: block;
      }
      .decision {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }
      .gist {
        font-size: 0.6875rem;
        font-weight: 600;
        color: var(--text);
        margin: 0;
      }
      .body {
        font-size: 0.625rem;
        color: var(--muted);
        white-space: pre-wrap;
        margin: 0;
      }
      .artifact {
        font-size: 0.5625rem;
        font-family: var(--font-mono, monospace);
        color: var(--flow-accent, var(--accent));
      }
    `;

    decision: string | undefined = undefined;
    gist: string | undefined = undefined;
    artifactPath: string | undefined = undefined;

    render() {
      return html`<div class="decision">
        ${
          this.gist !== undefined && this.gist !== ""
            ? html`<p class="gist">${this.gist}</p>`
            : nothing
        }
        ${
          this.decision !== undefined && this.decision !== ""
            ? html`<pre class="body">${this.decision}</pre>`
            : nothing
        }
        ${
          this.artifactPath !== undefined && this.artifactPath !== ""
            ? html`<span class="artifact">artifact: ${this.artifactPath}</span>`
            : nothing
        }
      </div>`;
    }
  }

  return { kinds: { "prototype-decision": PrototypeDecision } };
}
