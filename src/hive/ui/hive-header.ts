import type { HeaderData } from "./types";

const LOGO = [
  "                            h i v e",
  "   ,-.      .' '.        .`",
  "   \\_/      .   .       .",
  ":>(|||} .    ` .       .",
  "   / \\   '. . '  ' . '",
  "   `-'  ",
].join("\n");

export class HiveHeader extends HTMLElement {
  private shadow: ShadowRoot;
  private _data: HeaderData = {
    online: false,
    serverAddr: "—",
    lastProvider: null,
    lastModel: null,
  };

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
  }

  set data(value: HeaderData) {
    this._data = value;
    this.render();
  }

  connectedCallback() {
    this.render();
    this.updateThemeBtn();
  }

  private attachThemeListener() {
    this.shadow.querySelector(".theme-btn")?.addEventListener("click", () => {
      const light = document.documentElement.classList.toggle("light");
      const theme = light ? "light" : "dark";
      localStorage.setItem("theme", theme);
      this.updateThemeBtn();
    });
  }

  private updateThemeBtn() {
    const btn = this.shadow.querySelector(".theme-btn");
    if (btn) {
      btn.textContent = document.documentElement.classList.contains("light")
        ? "dark"
        : "light";
    }
  }

  private render() {
    const { online, serverAddr, lastProvider, lastModel } = this._data;
    const showCurrent = lastProvider && lastModel;
    this.shadow.innerHTML = `
      <style>
        :host {
          display: block;
          border-bottom: 1px solid var(--border);
          background: var(--card);
          position: sticky;
          top: 0;
          z-index: 50;
          padding: 0.5rem 1.25rem 0.375rem;
        }
        .header-inner {
          display: flex;
          justify-content: space-between;
          align-items: stretch;
          max-width: 1200px;
          margin: 0 auto;
        }
        header pre {
          font-family: monospace;
          font-size: 0.625rem;
          line-height: 1.3;
          color: var(--accent);
          margin: 0;
          white-space: pre;
        }
        .header-meta {
          text-align: right;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 0.375rem;
        }
        .server-addr {
          font-size: 0.625rem;
          color: var(--muted);
        }
        .badge-status {
          font-size: 0.625rem;
          font-weight: 700;
          padding: 0.125rem 0.5rem;
          border-radius: 0;
          display: inline-block;
        }
        .badge-status.on {
          background: rgba(var(--success-rgb), 0.12);
          color: var(--success);
          border: 1px solid var(--success);
        }
        .badge-status.off {
          background: rgba(var(--error-rgb), 0.12);
          color: var(--error);
          border: 1px solid var(--error);
        }
        .theme-btn {
          font-family: inherit;
          font-size: 0.5625rem;
          padding: 0.125rem 0.5rem;
          border: 1px solid var(--border);
          background: transparent;
          color: var(--muted);
          cursor: pointer;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .theme-btn:hover {
          border-color: var(--accent);
          color: var(--accent);
        }
        .current-use {
          font-size: 0.625rem;
          margin-top: auto;
        }
        .current-use .prov {
          text-transform: capitalize;
        }
        .current-use .model {
          font-family: monospace;
          color: var(--accent);
        }
      </style>
      <button class="theme-btn">dark</button>
      <div class="header-inner">
        <pre>${LOGO}</pre>
        <div class="header-meta">
          <span class="badge-status ${online ? "on" : "off"}">${online ? "ONLINE" : "OFFLINE"}</span>
          <span class="server-addr">${serverAddr}</span>
          ${showCurrent ? `<span class="current-use"><span class="prov">${lastProvider}</span> / <span class="model">${lastModel}</span></span>` : ""}
        </div>
      </div>
    `;
    this.updateThemeBtn();
    this.attachThemeListener();
  }
}

customElements.define("hive-header", HiveHeader);
