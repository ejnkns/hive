/** @public — the built-in authoring-session instance component. */

import { css, html, LitElement, nothing, type PropertyValues } from "lit";
import type {
  WorkflowDefResponse,
  WorkflowInstanceEntry,
} from "workflow-engine/create-flow-runtime";
import type {
  ChatMessage,
  CustomRenderKind,
} from "workflow-engine/workflow-types";
import { resolvePath } from "../resolve-path.ts";
import "./action-bar.ts";
import "./chat-session.ts";
import "./code-editor.ts";

// The flow-declared instance component for the flow-authoring workflow
// (ui.instanceComponent: "flow-editor"): the session header (title from the
// instance's prompt), the chat window (chat-session) with the Save button,
// and the editable code editor bound to the working definition source. This
// is the authoring session rendered as a flow instance: the definition's
// instance IS the editor.
//
// The editor is live and bidirectional: the agent's changes (previewSource /
// source) appear as the session works, and the human's direct edits write
// back into instance state (throttled, ~800 ms debounce, flushed on send /
// save / disconnect) marking the spec diverged — while diverged the agent's
// spec tools refuse and the human can discard their edits to hand back.

const WRITE_BACK_DEBOUNCE_MS = 800;

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
  onPatchState: ((values: Record<string, unknown>) => void) | undefined =
    undefined;

  // The human's in-flight edits, overriding the bound source until the
  // write-back round-trips (the round-trip guard: a WS snapshot reflecting
  // the shell's own patch must not clear the user's typing).
  private editedValue: string | null = null;
  private pendingWriteBack: string | null = null;
  private writeBackTimer: number | null = null;

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
      gap: 0.5rem;
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

    .diverged-note {
      margin: 0;
      font-size: 0.625rem;
      color: var(--warning);
      line-height: 1.4;
    }

    button.discard-btn {
      font-family: inherit;
      font-size: 0.625rem;
      height: 22px;
      padding: 0 0.5rem;
      border-radius: 4px;
      border: 1px solid var(--border);
      background: transparent;
      color: var(--warning);
      cursor: pointer;
      flex: none;
    }

    button.discard-btn:hover {
      border-color: var(--warning);
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
    const sessionSource = typeof state.source === "string" ? state.source : "";
    const previewErrors = Array.isArray(state.previewErrors)
      ? state.previewErrors.filter(
          (error): error is string => typeof error === "string"
        )
      : [];
    const actions = [...this.instanceEntry.availableActions].sort(
      byVariantPriority
    );
    const diverged = state.specDiverged === true;
    // The working artifact: the human's in-flight edits, else the agent's
    // generated source, else the live spec draft.
    const editorValue =
      this.editedValue ??
      (sessionSource !== "" ? sessionSource : previewSource);

    return html`
      <div class="editor">
        <div class="editor-header">
          <span class="editor-title">${this.sessionTitle()}</span>
        </div>
        ${this.renderChat(sessionSource)}
        ${this.renderEditorPane(editorValue, previewErrors, diverged)}
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

  protected override willUpdate(changed: PropertyValues<this>): void {
    // The round-trip guard: once a snapshot carries the exact source the
    // human typed (their own write-back echoed back), stop overriding the
    // display — future agent changes then show through normally. The pending
    // write-back is settled, so its timer is dropped too.
    if (changed.has("instanceEntry") && this.editedValue !== null) {
      const source = this.instanceEntry.state.workflowInstanceState.source;
      if (typeof source === "string" && source === this.editedValue) {
        this.editedValue = null;
        this.pendingWriteBack = null;
        if (this.writeBackTimer !== null) {
          window.clearTimeout(this.writeBackTimer);
          this.writeBackTimer = null;
        }
      }
    }
  }

  public override disconnectedCallback(): void {
    super.disconnectedCallback();
    // Flush any pending write-back when the editor unmounts (navigation).
    void this.flushWriteBack();
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
  // a source exists) emits hive-action "save" (the shell answers with the
  // synchronous save route); the saved line reflects the last save.
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
          @click=${() => void this.handleSaveClick()}
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

  // The editable code pane: the working definition source (the human's edits
  // or the agent's latest), the draft notes from the spec validator, and —
  // while diverged — the discard handoff.
  private renderEditorPane(value: string, errors: string[], diverged: boolean) {
    return html`<div class="pane">
      <div class="pane-head">
        <span class="pane-title">Definition source (.ts)</span>
        ${
          diverged
            ? html`<button
                class="discard-btn"
                type="button"
                @click=${() => this.emitAction("discard")}
              >
                Discard edits
              </button>`
            : nothing
        }
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
      <code-editor
        .value=${value}
        @hive-code-change=${this.handleCodeChange}
      ></code-editor>
      ${
        diverged
          ? html`<p class="diverged-note"
              >Manual edits — the agent's spec is frozen. Propose changes in
              chat or discard your edits to hand the definition back.</p
            >`
          : nothing
      }
    </div>`;
  }

  // ── write-back (throttled) ──────────────────────────────────────────

  private handleCodeChange = (event: CustomEvent<{ value: string }>): void => {
    const value = event.detail.value;
    this.pendingWriteBack = value;
    this.editedValue = value;
    if (this.writeBackTimer !== null) {
      window.clearTimeout(this.writeBackTimer);
    }
    this.writeBackTimer = window.setTimeout(
      () => void this.flushWriteBack(),
      WRITE_BACK_DEBOUNCE_MS
    );
    this.requestUpdate();
  };

  // Writes the pending snapshot into the session state (marking the spec
  // diverged). Returns when the patch is in flight; save/send await it so the
  // definition being saved or reasoned about includes the human's latest text.
  private async flushWriteBack(): Promise<void> {
    if (this.writeBackTimer !== null) {
      window.clearTimeout(this.writeBackTimer);
      this.writeBackTimer = null;
    }
    const value = this.pendingWriteBack;
    this.pendingWriteBack = null;
    if (value === null) return;
    this.emitPatchState({ source: value });
  }

  private async handleSaveClick(): Promise<void> {
    await this.flushWriteBack();
    this.emitAction("save");
  }

  private emitPatchState(values: Record<string, unknown>): void {
    if (this.onPatchState !== undefined) {
      this.onPatchState(values);
      return;
    }
    this.dispatchEvent(
      new CustomEvent("hive-patch-state", {
        detail: { instanceId: this.instanceEntry.id, values },
        bubbles: true,
        composed: true,
      })
    );
  }

  // ── action / message forwarding ─────────────────────────────────────

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
    // Flush the pending write-back before the turn starts so the agent's
    // tools read the human's latest source.
    void this.flushWriteBack().then(() => {
      this.emitSendMessage(event.detail.content);
    });
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
