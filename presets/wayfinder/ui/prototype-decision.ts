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
  const { LitElement: Base, html, css, utilities, nothing } = lit;

  class PrototypeDecision extends Base {
    static properties = {
      decision: { attribute: false },
      gist: { attribute: false },
      artifactPath: { attribute: false },
    };

    static styles = [
      utilities,
      css`
        :host {
          display: block;
        }
        .decision {
          gap: 0.375rem;
        }
        .gist {
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
        }
      `,
    ];

    decision: string | undefined = undefined;
    gist: string | undefined = undefined;
    artifactPath: string | undefined = undefined;

    render() {
      return html`<div class="decision flex flex-col">
        ${
          this.gist !== undefined && this.gist !== ""
            ? html`<p class="gist text-xs">${this.gist}</p>`
            : nothing
        }
        ${
          this.decision !== undefined && this.decision !== ""
            ? html`<pre class="body text-muted">${this.decision}</pre>`
            : nothing
        }
        ${
          this.artifactPath !== undefined && this.artifactPath !== ""
            ? html`<span class="artifact text-accent">artifact: ${this.artifactPath}</span>`
            : nothing
        }
      </div>`;
    }
  }

  return { kinds: { "prototype-decision": PrototypeDecision } };
}
