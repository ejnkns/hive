/** The served ideas card module (FlowDefinition.ui.components "idea-card").
 * A standalone erasable-syntax module: type-only imports from the module-set
 * allowlist (lit + the engine contract types), default-export factory
 * receiving the app's lit runtime. The module-set gate lints, import-policies,
 * and typechecks this file; the server strips types and serves it at the
 * component route; the rendering surface blob-imports and registers whatever
 * the factory returns. */

import type {
  FlowComponentDeps,
  FlowComponentRegistrations,
  InstanceComponentProps,
} from "workflow-engine/workflow-types";

export default function (lit: FlowComponentDeps): FlowComponentRegistrations {
  const { LitElement: Base, html, css } = lit;

  class IdeaCard extends Base {
    static properties = {
      workflowDef: { attribute: false },
      instanceEntry: { attribute: false },
      onAction: { attribute: false },
      onSendMessage: { attribute: false },
    };

    static styles = css`
      :host {
        display: block;
      }
      .idea {
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--surface);
        padding: 0.75rem 0.875rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .idea-title {
        font-weight: 700;
        font-size: 0.8125rem;
        color: var(--text);
      }
      .idea-state {
        font-size: 0.5625rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted);
      }
      .idea-spec {
        font-size: 0.6875rem;
        line-height: 1.5;
        color: var(--text);
        white-space: pre-wrap;
        margin: 0;
      }
      .idea-chat {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }
      .idea-msg {
        font-size: 0.625rem;
        color: var(--text);
      }
      .idea-input-row {
        display: flex;
        gap: 0.375rem;
      }
      input {
        flex: 1;
        font-family: inherit;
        font-size: 0.625rem;
        padding: 0.25rem 0.5rem;
        border: 1px solid var(--border);
        border-radius: 4px;
        background: var(--bg);
        color: var(--text);
        outline: none;
      }
      button {
        font-family: inherit;
        font-size: 0.625rem;
        height: 24px;
        padding: 0 0.5rem;
        border-radius: 4px;
        border: 1px solid var(--border);
        background: var(--success);
        color: var(--bg);
        cursor: pointer;
      }
      .idea-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.375rem;
      }
    `;

    declare workflowDef: InstanceComponentProps["workflowDef"];
    declare instanceEntry: InstanceComponentProps["instanceEntry"];
    declare onAction: InstanceComponentProps["onAction"] | undefined;
    declare onSendMessage: InstanceComponentProps["onSendMessage"] | undefined;
    input = "";

    render() {
      const state = this.instanceEntry.state;
      const title = state.workflowInstanceState.title ?? this.instanceEntry.id;
      const stateDef = this.workflowDef.states.find(
        (s) => s.id === state.currentState
      );
      const elaborate = state.taskOutputs.elaborate;
      const spec =
        elaborate !== undefined && elaborate.status === "success"
          ? readOutputString(elaborate.output, "elaboratedSpec")
          : "";
      const actions = this.instanceEntry.availableActions ?? [];
      const running =
        state.hasRunningTask && state.runningTaskContext !== null
          ? state.runningTaskContext
          : null;
      return html`
        <div class="idea">
          <div class="idea-title">${title}</div>
          <div class="idea-state">
            ${stateDef !== undefined ? stateDef.label : state.currentState}
          </div>
          ${
            running !== null && running.role === "ai-chat"
              ? html`<div class="idea-chat">
                ${(running.messages ?? []).map(
                  (m) =>
                    html`<div class="idea-msg">${m.role}: ${m.content}</div>`
                )}
                <div class="idea-input-row">
                  <input
                    placeholder="Message the elaborating agent..."
                    @input=${(e: Event) => {
                      this.input = (e.target as HTMLInputElement).value;
                    }}
                    @keydown=${(e: KeyboardEvent) => {
                      if (e.key === "Enter") this.send();
                    }}
                  />
                  <button
                    @click=${() => {
                      this.send();
                    }}
                  >
                    Send
                  </button>
                </div>
              </div>`
              : ""
          }
          ${spec !== "" ? html`<pre class="idea-spec">${spec}</pre>` : ""}
          ${
            actions.length > 0
              ? html`<div class="idea-actions">
                ${actions.map(
                  (a) =>
                    html`<button
                      @click=${() => {
                        if (this.onAction !== undefined) this.onAction(a.id);
                      }}
                    >
                      ${a.label}
                    </button>`
                )}
              </div>`
              : ""
          }
        </div>
      `;
    }

    send() {
      const text = this.input.trim();
      if (text !== "" && this.onSendMessage !== undefined) {
        this.onSendMessage(text);
        this.input = "";
      }
    }
  }

  return { components: { "idea-card": IdeaCard } };
}

// Reads a string field off a task-completion output object (the task output
// shape is open; the read is defensive — an absent or non-string value is
// rendered as empty).
function readOutputString(output: unknown, field: string): string {
  if (output === null || typeof output !== "object") return "";
  const value = (output as Record<string, unknown>)[field];
  return typeof value === "string" ? value : "";
}
