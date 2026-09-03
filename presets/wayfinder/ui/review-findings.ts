/** The "review-findings" custom render kind: the build reviewer's verdict and
 * its findings ({ axis, severity, detail, evidence }). Bound on the buildItem
 * review task's output in the wayfinder definition. */

import type { LitElement } from "lit";
import type {
  FlowComponentDeps,
  FlowComponentRegistrations,
} from "workflow-engine/workflow-types";

export default function (lit: FlowComponentDeps): FlowComponentRegistrations {
  const { LitElement: Base, html, css, utilities, nothing } = lit;

  class ReviewFindings extends Base {
    static properties = {
      verdict: { attribute: false },
      findings: { attribute: false },
    };

    static styles = [
      utilities,
      css`
        :host {
          display: block;
        }
        .review {
          gap: 0.375rem;
        }
        .verdict {
          letter-spacing: 0.06em;
        }
        .verdict[data-verdict="approved"] {
          color: var(--success);
        }
        .verdict[data-verdict="changes_requested"] {
          color: var(--error);
        }
        .finding {
          padding: 0.375rem 0.5rem;
          gap: 0.125rem;
        }
        .finding-head {
          gap: 0.375rem;
        }
        .finding-axis {
          font-size: 0.5625rem;
          letter-spacing: 0.05em;
        }
        .finding-severity {
          font-size: 0.5625rem;
        }
        .finding-severity[data-severity="minor"] {
          color: var(--muted);
        }
        .finding-detail {
          font-size: 0.625rem;
          color: var(--text);
          margin: 0;
        }
        .finding-evidence {
          font-size: 0.5625rem;
          font-family: var(--font-mono, monospace);
        }
      `,
    ];

    verdict: string | undefined = undefined;
    findings: unknown[] = [];

    render() {
      const findings = Array.isArray(this.findings) ? this.findings : [];
      return html`<div class="review flex flex-col">
        ${
          this.verdict !== undefined && this.verdict !== ""
            ? html`<div class="verdict text-xs font-bold uppercase" data-verdict=${this.verdict}
              >${this.verdict}</div
            >`
            : nothing
        }
        ${findings.map(
          (
            finding
          ) => html`<div class="finding border rounded-md bg-bg flex flex-col">
            <div class="finding-head flex items-center">
              <span class="finding-axis text-muted font-bold uppercase"
                >${readString(finding, "axis")}</span
              >
              <span
                class="finding-severity text-error font-bold"
                data-severity=${readString(finding, "severity")}
                >${readString(finding, "severity")}</span
              >
            </div>
            ${
              readString(finding, "detail") !== ""
                ? html`<p class="finding-detail"
                  >${readString(finding, "detail")}</p
                >`
                : ""
            }
            ${
              readString(finding, "evidence") !== ""
                ? html`<span class="finding-evidence text-muted"
                  >${readString(finding, "evidence")}</span
                >`
                : ""
            }
          </div>`
        )}
      </div>`;
    }
  }

  return { kinds: { "review-findings": ReviewFindings } };
}

function readString(item: unknown, field: string): string {
  if (item === null || typeof item !== "object") return "";
  const value = (item as Record<string, unknown>)[field];
  return typeof value === "string" ? value : "";
}
