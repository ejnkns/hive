/** The "findings-report" custom render kind: a research ticket's cited
 * findings report + its primary-source list. Bound on the research task's
 * output in the wayfinder definition; registered by the served module. */

import type { LitElement } from "lit";
import type {
  FlowComponentDeps,
  FlowComponentRegistrations,
} from "workflow-engine/workflow-types";

export default function (lit: FlowComponentDeps): FlowComponentRegistrations {
  const { LitElement: Base, html, css, nothing } = lit;

  class FindingsReport extends Base {
    static properties = {
      findings: { attribute: false },
      sources: { attribute: false },
    };

    static styles = css`
      :host {
        display: block;
      }
      .findings {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .findings-body {
        font-size: 0.6875rem;
        line-height: 1.5;
        color: var(--text);
        white-space: pre-wrap;
        margin: 0;
      }
      .sources-label {
        font-size: 0.5625rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted);
      }
      .source {
        font-size: 0.5625rem;
        font-family: var(--font-mono, monospace);
        color: var(--flow-accent, var(--accent));
        display: block;
        overflow-wrap: anywhere;
      }
    `;

    findings: string | undefined = undefined;
    sources: string[] = [];

    render() {
      const sources = Array.isArray(this.sources) ? this.sources : [];
      return html`<div class="findings">
        ${
          this.findings !== undefined && this.findings !== ""
            ? html`<pre class="findings-body">${this.findings}</pre>`
            : nothing
        }
        ${
          sources.length > 0
            ? html`<div>
              <div class="sources-label">sources</div>
              ${sources.map(
                (source) => html`<span class="source">${source}</span>`
              )}
            </div>`
            : nothing
        }
      </div>`;
    }
  }

  return { kinds: { "findings-report": FindingsReport } };
}
