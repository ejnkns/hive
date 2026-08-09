import { css, html, LitElement, nothing } from "lit";

export class ItemHeader extends LitElement {
  static properties = {
    title: { type: String },
    subtitle: { type: String },
    category: { type: String },
    isTerminal: { type: Boolean },
    hasRunningTask: { type: Boolean },
    description: { type: String },
    compact: { type: Boolean },
  };

  static styles = css`
    .header {
      margin-bottom: 0.625rem;
    }

    .title-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .title {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 0.875rem;
      font-weight: 700;
      color: var(--text);
    }

    .subtitle {
      flex: none;
      min-width: 0;
      max-width: 45%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 0.625rem;
      color: var(--muted);
    }

    .description {
      font-size: 0.6875rem;
      line-height: 1.4;
      color: var(--muted);
      margin-top: 0.375rem;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      height: 18px;
      padding: 0 4px;
      border-radius: 4px;
      font-family: monospace;
      font-weight: 600;
      font-size: 0.5625rem;
      white-space: nowrap;
    }

    .badge-mint {
      background: transparent;
      color: var(--success);
      border: 1px solid var(--success);
    }

    .badge-rose {
      background: transparent;
      color: var(--error);
      border: 1px solid var(--error);
    }

    .badge-platinum {
      background: transparent;
      color: var(--muted);
      border: 1px solid var(--border);
    }

    .badge-amber {
      background: transparent;
      color: var(--warning);
      border: 1px solid var(--warning);
    }

    .badge-live::before {
      content: "";
      display: inline-block;
      width: 5px;
      height: 5px;
      border-radius: 50%;
      margin-right: 3px;
      background: currentColor;
      animation: live-pulse 2s ease-in-out infinite;
    }

    @keyframes live-pulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.3;
      }
    }
  `;

  title = "";
  subtitle = "";
  category = "active";
  isTerminal = false;
  hasRunningTask = false;
  description = "";
  compact = false;

  render() {
    return html`
      <div class="header">
        <div class="title-row">
          <span class="title" title=${this.title}>${this.title}</span>
          ${
            this.subtitle
              ? html`<span class="subtitle" title=${this.subtitle}
                >${this.subtitle}</span
              >`
              : nothing
          }
          ${this.renderBadges()}
        </div>
        ${
          !this.compact && this.description
            ? html`<div class="description">${this.description}</div>`
            : nothing
        }
      </div>
    `;
  }

  private renderBadges() {
    const badges = [];
    if (this.category === "terminal" || this.isTerminal) {
      badges.push(html`<span class="badge badge-mint">Done</span>`);
    } else if (this.category === "error") {
      badges.push(html`<span class="badge badge-rose">Blocked</span>`);
    } else if (this.category === "initial") {
      badges.push(html`<span class="badge badge-platinum">Ready</span>`);
    }
    if (this.hasRunningTask) {
      badges.push(
        html`<span class="badge badge-amber badge-live">Running</span>`
      );
    }
    return badges;
  }
}

customElements.define("item-header", ItemHeader);
