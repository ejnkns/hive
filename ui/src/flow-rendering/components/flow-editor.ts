/** @public — the built-in authoring-session instance component. */

import { css, html, LitElement, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type {
  WorkflowDefResponse,
  WorkflowInstanceEntry,
} from "workflow-engine/create-flow-runtime";
import type {
  ChatMessage,
  CustomRenderKind,
} from "workflow-engine/workflow-types";
import { resolvePath } from "../resolve-path.ts";
import { highlightTypeScript } from "../ts-highlight.ts";
import "./action-bar.ts";
import "./chat-session.ts";

// The flow-declared instance component for the flow-authoring workflow
// (ui.instanceComponent: "flow-editor"): the session header (title from the
// instance's prompt), the running ai-chat (chat-session), the tokenized code
// pane bound to previewSource/previewErrors, and the action row (action-bar
// from availableActions — validate/save execute REST in the Svelte shell via
// the onAction callback, by design). This is the authoring session rendered
// as a flow instance: the definition's instance IS the editor.

export class FlowEditor extends LitElement {
  static properties = {
    workflowDef: { attribute: false },
    instanceEntry: { attribute: false },
    customKinds: { attribute: false },
  };

  // Callback props (the InstanceComponentProps contract); when provided they
  // replace event dispatch so the editor shares one interface with the
  // default card.
  onAction:
    | ((actionId: string, payload?: Record<string, unknown>) => void)
    | undefined = undefined;
  onSendMessage: ((content: string) => Promise<void>) | undefined = undefined;

  static styles = css`
    :host {
      display: block;
    }

    .editor {
      border: 1px solid var(--card-border, var(--border));
      border-radius: 8px;
      background: var(--surface);
      padding: 0.875rem 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .editor-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.5rem;
    }

    .editor-title {
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--text);
      overflow-wrap: anywhere;
    }

    .editor-chat {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
    }

    .chat-toolbar {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.5rem;
    }

    .saved-block {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      min-width: 0;
    }

    .saved-status {
      font-size: 0.625rem;
      color: var(--success);
      overflow-wrap: anywhere;
    }

    .saved-findings {
      margin: 0;
      padding-left: 1.125rem;
      color: var(--warning);
      font-size: 0.625rem;
      line-height: 1.4;
      overflow-wrap: anywhere;
    }

    button.save-btn {
      font-family: inherit;
      font-size: 0.625rem;
      height: 24px;
      padding: 0 0.5rem;
      border-radius: 4px;
      border: 1px solid transparent;
      background: var(--success);
      color: var(--bg);
      cursor: pointer;
      flex: none;
    }

    button.save-btn:hover:not(:disabled) {
      filter: brightness(1.1);
    }

    button.save-btn:disabled {
      opacity: 0.5;
      cursor: default;
    }

    .pane {
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
    }

    .pane-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .pane-title {
      font-size: 0.5625rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 700;
    }

    .pane-notes-head {
      font-size: 0.625rem;
      font-weight: 600;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .pane-errors {
      margin: 0.25rem 0 0 0;
      padding-left: 1.125rem;
      color: var(--warning);
      font-size: 0.6875rem;
      line-height: 1.5;
      overflow-wrap: anywhere;
    }

    .code {
      margin: 0;
      max-height: 260px;
      overflow-y: auto;
      padding: 0.375rem 0.5rem;
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid var(--border);
      border-radius: 4px;
      font-family: var(--font-mono, monospace);
      font-size: 0.625rem;
      line-height: 1.45;
      color: var(--text);
      white-space: pre-wrap;
      word-break: break-word;
    }

    .code :global(.tok-keyword) {
      color: var(--accent);
    }

    .code :global(.tok-string) {
      color: var(--success);
    }

    .code :global(.tok-number) {
      color: var(--warning);
    }

    .code :global(.tok-comment) {
      color: var(--muted);
      font-style: italic;
    }

    .editor-actions {
      display: flex;
    }
  `;

  workflowDef: WorkflowDefResponse = null as unknown as WorkflowDefResponse;
  instanceEntry: WorkflowInstanceEntry =
    null as unknown as WorkflowInstanceEntry;
  customKinds: readonly CustomRenderKind[] = [];

  render() {
    const state = this.instanceEntry.state.workflowInstanceState;
    const previewSource =
      typeof state.previewSource === "string" ? state.previewSource : "";
    const previewErrors = Array.isArray(state.previewErrors)
      ? state.previewErrors.filter(
          (error): error is string => typeof error === "string"
        )
      : [];
    const actions = [...this.instanceEntry.availableActions].sort(
      byVariantPriority
    );
    const source = typeof state.source === "string" ? state.source : "";

    return html`
      <div class="editor">
        <div class="editor-header">
          <span class="editor-title">${this.sessionTitle()}</span>
        </div>
        ${this.renderChat(source)}
        ${this.renderPane(previewSource, previewErrors)}
        ${
          actions.length > 0
            ? html`<div class="editor-actions">
              <action-bar
                .actions=${actions}
                @hive-action=${this.handleAction}
              ></action-bar>
            </div>`
            : nothing
        }
      </div>
    `;
  }

  // The session header title: the workflow's instance hint (title: "prompt")
  // resolved against instance state, falling back to the state label.
  private sessionTitle(): string {
    const hinted = this.resolveString(this.workflowDef.instance?.title ?? "");
    if (hinted !== undefined) return hinted;
    const stateLabel = this.workflowDef.states.find(
      (state) => state.id === this.instanceEntry.state.currentState
    )?.label;
    return stateLabel ?? this.instanceEntry.state.currentState;
  }

  private resolveString(path: string): string | undefined {
    if (path === "") return undefined;
    const value = resolvePath(
      this.instanceEntry.state.workflowInstanceState,
      path
    );
    return typeof value === "string" ? value : undefined;
  }

  // The chat window with the save affordance: the Save button (enabled once
  // the agent has generated a source) emits hive-action "save", which the
  // shell answers with the synchronous save route — the same
  // saveAuthoringDefinition core the agent's save_definition tool runs. The
  // saved line reflects the last save from instance state.
  private renderChat(source: string) {
    const ctx = this.instanceEntry.state.runningTaskContext;
    const state = this.instanceEntry.state.workflowInstanceState;
    const savedId =
      typeof state.savedDefinitionId === "string"
        ? state.savedDefinitionId
        : "";
    const savedName =
      typeof state.savedName === "string" ? state.savedName : "";
    const saveFindings = state.saveFindings;
    const warnings =
      saveFindings !== null &&
      typeof saveFindings === "object" &&
      "warnings" in saveFindings &&
      Array.isArray(saveFindings.warnings)
        ? saveFindings.warnings.length
        : 0;
    const errors =
      saveFindings !== null &&
      typeof saveFindings === "object" &&
      "errors" in saveFindings &&
      Array.isArray(saveFindings.errors)
        ? saveFindings.errors.filter((e): e is string => typeof e === "string")
        : [];
    return html`<div class="editor-chat">
      <div class="chat-toolbar">
        <div class="saved-block">
          ${
            savedId !== ""
              ? html`<span class="saved-status"
                  >Saved as ${savedName !== "" ? savedName : savedId}
                  (${savedId})${warnings > 0 ? ` · ${warnings} warning(s)` : ""}</span
                >`
              : nothing
          }
          ${
            errors.length > 0 || warnings > 0
              ? html`<ul class="saved-findings">
                  ${[
                    ...errors,
                    ...(warnings > 0 ? [`${warnings} warning(s)`] : []),
                  ].map((finding) => html`<li>${finding}</li>`)}
                </ul>`
              : nothing
          }
        </div>
        <button
          class="save-btn"
          type="button"
          ?disabled=${source === ""}
          @click=${() => this.emitAction("save")}
        >
          Save definition
        </button>
      </div>
      ${
        ctx !== null && ctx.role === "ai-chat"
          ? html`<chat-session
              .messages=${ctx.messages}
              .sessionId=${ctx.sessionId}
              .interactive=${ctx.interactive}
              .thinking=${this.agentIsThinking(ctx.messages)}
              .modelStatus=${ctx.modelStatus}
              @hive-send-message=${this.handleSendMessage}
            ></chat-session>`
          : nothing
      }
    </div>`;
  }

  // The agent is composing its next reply when the task is running and the
  // transcript ends on anything but an assistant message.
  private agentIsThinking(messages: ChatMessage[]): boolean {
    if (!this.instanceEntry.state.hasRunningTask) return false;
    const last = messages[messages.length - 1];
    return last !== undefined && last.role !== "assistant";
  }

  // The tokenized spec preview: the agent's live draft rendered as TS, plus
  // its validation/render findings as draft notes.
  private renderPane(source: string, errors: string[]) {
    if (source === "" && errors.length === 0) return nothing;
    return html`<div class="pane">
      <div class="pane-head">
        <span class="pane-title">Spec preview (.ts)</span>
      </div>
      ${
        errors.length > 0
          ? html`<div>
            <span class="pane-notes-head">Draft notes</span>
            <ul class="pane-errors">
              ${errors.map((error) => html`<li>${error}</li>`)}
            </ul>
          </div>`
          : nothing
      }
      ${
        source !== ""
          ? // The highlighter escapes all non-token content; only its own
            // fixed-class token spans are injected, so unsafeHTML is safe.
            html`<pre class="code">${unsafeHTML(highlightTypeScript(source))}</pre>`
          : nothing
      }
    </div>`;
  }

  private handleAction = (
    event: CustomEvent<{ actionId: string; payload?: Record<string, unknown> }>
  ) => {
    // The action-bar's event carries no flow/instance ids; stop it so the
    // re-emitted event (with ids) is the only one that reaches the host.
    event.stopPropagation();
    this.emitAction(event.detail.actionId, event.detail.payload);
  };

  private handleSendMessage = (event: CustomEvent<{ content: string }>) => {
    event.stopPropagation();
    this.emitSendMessage(event.detail.content);
  };

  private emitAction(
    actionId: string,
    payload?: Record<string, unknown>
  ): void {
    if (this.onAction !== undefined) {
      this.onAction(actionId, payload);
      return;
    }
    this.dispatchEvent(
      new CustomEvent("hive-action", {
        detail: {
          instanceId: this.instanceEntry.id,
          actionId,
          payload,
        },
        bubbles: true,
        composed: true,
      })
    );
  }

  private emitSendMessage(content: string): void {
    if (this.onSendMessage !== undefined) {
      void this.onSendMessage(content);
      return;
    }
    this.dispatchEvent(
      new CustomEvent("hive-send-message", {
        detail: { instanceId: this.instanceEntry.id, content },
        bubbles: true,
        composed: true,
      })
    );
  }
}

customElements.define("flow-editor", FlowEditor);

// Available actions order by variant so the primary call-to-action leads.
const ACTION_VARIANT_PRIORITY: Record<string, number> = {
  primary: 0,
  secondary: 1,
  default: 2,
  destructive: 3,
};

function byVariantPriority(
  a: { variant: string },
  b: { variant: string }
): number {
  return (
    (ACTION_VARIANT_PRIORITY[a.variant] ?? 4) -
    (ACTION_VARIANT_PRIORITY[b.variant] ?? 4)
  );
}
