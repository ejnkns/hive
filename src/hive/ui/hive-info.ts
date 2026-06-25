export class HiveInfo extends HTMLElement {
  private shadow: ShadowRoot;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.render();
  }

  private render() {
    const text = this.textContent || "";
    this.shadow.innerHTML = `
      <style>
        .info-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 1rem;
          height: 1rem;
          border: 1px solid var(--muted);
          background: transparent;
          color: var(--muted);
          font-size: 0.5625rem;
          cursor: pointer;
          border-radius: 50%;
          font: inherit;
          line-height: 1;
          padding: 0;
          vertical-align: middle;
          margin-left: 0.25rem;
          flex-shrink: 0;
          text-transform: none;
          letter-spacing: 0;
        }
        .info-btn:hover {
          border-color: var(--accent);
          color: var(--accent);
        }
        .info-popover {
          border: 1px solid var(--border);
          background: var(--card);
          color: var(--text);
          font-size: 0.75rem;
          padding: 0.5rem 0.75rem;
          max-width: 260px;
          line-height: 1.4;
          font-family: monospace;
          position: fixed;
          top: anchor(bottom);
          left: anchor(center);
          translate: -50% 0;
          margin-top: 0.375rem;
        }
      </style>
      <button popovertarget="p" type="button" class="info-btn" aria-label="More info">i</button>
      <div id="p" popover="auto" class="info-popover" role="tooltip">${text}</div>
    `;
  }
}

customElements.define("hive-info", HiveInfo);
