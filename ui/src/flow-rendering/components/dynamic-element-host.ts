import { css, html, LitElement } from "lit";

export type ElementConstructor = new () => HTMLElement;

// Mounts an element class instance with the given props into its own shadow
// root. The instance is reused across renders while the class stays the same
// (only props update); a class change swaps the element. This is the mount
// point for flow-declared custom components and registered render kinds.
export class DynamicElementHost extends LitElement {
  static properties = {
    elementClass: { attribute: false },
    props: { attribute: false },
  };

  static styles = css`
    .mount {
      display: contents;
    }
  `;

  elementClass: ElementConstructor | null = null;
  props: Record<string, unknown> = {};

  private mounted: HTMLElement | null = null;

  render() {
    return html`<div class="mount"></div>`;
  }

  protected override updated(): void {
    this.syncElement();
  }

  private syncElement(): void {
    if (this.elementClass === null) return;
    const container = this.renderRoot.querySelector(".mount");
    if (container === null) return;
    if (
      this.mounted === null ||
      this.mounted.constructor !== this.elementClass
    ) {
      this.mounted?.remove();
      this.mounted = new this.elementClass();
      container.appendChild(this.mounted);
    }
    // Setting props on the dynamically constructed element casts through
    // unknown because the element's property surface is unknown here.
    const mounted = this.mounted as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(this.props)) {
      mounted[key] = value;
    }
  }
}

customElements.define("dynamic-element-host", DynamicElementHost);
