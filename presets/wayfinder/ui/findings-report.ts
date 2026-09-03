/** The "findings-report" custom render kind: a research ticket's cited
 * findings report + its primary-source list. Bound on the research task's
 * output in the wayfinder definition; registered by the served module. */

import type { LitElement } from "lit";
import type {
  FlowComponentDeps,
  FlowComponentRegistrations,
} from "workflow-engine/workflow-types";

export default function (lit: FlowComponentDeps): FlowComponentRegistrations {
  const { LitElement: Base, html, css, utilities, nothing } = lit;

  class FindingsReport extends Base {
    static properties = {
      findings: { attribute: false },
      sources: { attribute: false },
    };

    static styles = [
      utilities,
      css`
        :host {
          display: block;
        }
        .findings-body {
          line-height: 1.5;
          color: var(--text);
          white-space: pre-wrap;
          margin: 0;
        }
        .sources-label {
          font-size: 0.5625rem;
          letter-spacing: 0.06em;
        }
        .source {
          font-size: 0.5625rem;
          font-family: var(--font-mono, monospace);
          overflow-wrap: anywhere;
        }
      `,
    ];

    findings: string | undefined = undefined;
    sources: string[] = [];

    render() {
      const sources = Array.isArray(this.sources) ? this.sources : [];
      return html`<div class="findings flex flex-col gap-2">
        ${
          this.findings !== undefined && this.findings !== ""
            ? html`<pre class="findings-body text-xs">${this.findings}</pre>`
            : nothing
        }
        ${
          sources.length > 0
            ? html`<div>
              <div class="sources-label text-muted font-bold uppercase">sources</div>
              ${sources.map(
                (source) =>
                  html`<span class="source text-accent block">${source}</span>`
              )}
            </div>`
            : nothing
        }
      </div>`;
    }
  }

  return { kinds: { "findings-report": FindingsReport } };
}
