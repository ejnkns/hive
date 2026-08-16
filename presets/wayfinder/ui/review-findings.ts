/** The "review-findings" custom render kind: the build reviewer's verdict and
 * its findings ({ axis, severity, detail, evidence }). Bound on the buildItem
 * review task's output in the wayfinder definition. */

import type { LitElement } from "lit";
import type {
  FlowComponentDeps,
  FlowComponentRegistrations,
} from "workflow-engine/workflow-types";

export default function (lit: FlowComponentDeps): FlowComponentRegistrations {
  const { LitElement: Base, html, css, nothing } = lit;

  class ReviewFindings extends Base {
    static properties = {
      verdict: { attribute: false },
      findings: { attribute: false },
    };

    static styles = css`
      :host {
        display: block;
      }
      .review {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }
      .verdict {
        font-size: 0.6875rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .verdict[data-verdict="approved"] {
        color: var(--success);
      }
      .verdict[data-verdict="changes_requested"] {
        color: var(--error);
      }
      .finding {
        border: 1px solid var(--border);
        border-radius: 6px;
        background: var(--bg);
        padding: 0.375rem 0.5rem;
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
      }
      .finding-head {
        display: flex;
        align-items: center;
        gap: 0.375rem;
      }
      .finding-axis {
        font-size: 0.5625rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--muted);
      }
      .finding-severity {
        font-size: 0.5625rem;
        font-weight: 700;
        color: var(--error);
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
        color: var(--muted);
      }
    `;

    verdict: string | undefined = undefined;
    findings: unknown[] = [];

    render() {
      const findings = Array.isArray(this.findings) ? this.findings : [];
      return html`<div class="review">
        ${
          this.verdict !== undefined && this.verdict !== ""
            ? html`<div class="verdict" data-verdict=${this.verdict}
              >${this.verdict}</div
            >`
            : nothing
        }
        ${findings.map(
          (finding) => html`<div class="finding">
            <div class="finding-head">
              <span class="finding-axis"
                >${readString(finding, "axis")}</span
              >
              <span
                class="finding-severity"
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
                ? html`<span class="finding-evidence"
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
