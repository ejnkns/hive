import { css, html, LitElement, nothing } from "lit";

export type CardsViewItem = {
  title?: string;
  description?: string;
  bullets?: string[];
};

export class CardsView extends LitElement {
  static properties = {
    items: { attribute: false },
  };

  static styles = css`
    .cards {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
    }
  `;

  items: CardsViewItem[] = [];

  render() {
    if (this.items.length === 0) return nothing;
    return html`<div class="cards">
      ${this.items.map(
        (item) => html`<card-view
          .title=${item.title ?? ""}
          .description=${item.description ?? ""}
          .bullets=${item.bullets ?? []}
        ></card-view>`
      )}
    </div>`;
  }
}

customElements.define("cards-view", CardsView);
