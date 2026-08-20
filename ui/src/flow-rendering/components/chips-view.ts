import { css, html, LitElement, nothing } from "lit";

// The builtin chips render kind: a bound array renders as inline pills. Items
// are stringified defensively (a non-string item renders as its String form);
// a non-array `items` renders nothing — contract resolution falls back to json
// before this point, but the guard keeps the element itself total.
export class ChipsView extends LitElement {
  static properties = {
    items: { attribute: false },
  };

  static styles = css`
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
    }

    .chip {
      display: inline-block;
      padding: 0.125rem 0.5rem;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface);
      color: var(--muted);
      font-size: 0.6875rem;
    }
  `;

  items: unknown[] = [];

  render() {
    if (!Array.isArray(this.items) || this.items.length === 0) return nothing;
    return html`<div class="chips">
      ${this.items.map(
        (item) => html`<span class="chip">${String(item)}</span>`
      )}
    </div>`;
  }
}

customElements.define("chips-view", ChipsView);
