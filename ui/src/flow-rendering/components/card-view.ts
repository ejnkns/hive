import { css, html, LitElement, nothing } from "lit";

export class CardView extends LitElement {
  static properties = {
    title: { type: String },
    description: { type: String },
    bullets: { attribute: false },
  };

  static styles = css`
    .card {
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 0.375rem 0.5rem;
      background: var(--bg);
    }

    .title {
      font-weight: 700;
      color: var(--text);
      font-size: 0.6875rem;
    }

    .description {
      color: var(--muted);
      margin-top: 0.125rem;
      font-size: 0.625rem;
      white-space: pre-wrap;
    }

    ul {
      margin: 0.25rem 0 0 0;
      padding-left: 1rem;
      color: var(--muted);
      font-size: 0.625rem;
    }
  `;

  title = "";
  description = "";
  bullets: string[] = [];

  render() {
    return html`
      <div class="card">
        ${this.title ? html`<div class="title">${this.title}</div>` : nothing}
        ${
          this.description
            ? html`<div class="description">${this.description}</div>`
            : nothing
        }
        ${
          this.bullets && this.bullets.length > 0
            ? html`<ul>${this.bullets.map((bullet) => html`<li>${bullet}</li>`)}</ul>`
            : nothing
        }
      </div>
    `;
  }
}

customElements.define("card-view", CardView);
