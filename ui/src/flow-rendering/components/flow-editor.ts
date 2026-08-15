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
import "./chat-session.ts";
import "./code-editor.ts";

// The flow-declared instance component for the flow-authoring workflow
// (ui.instanceComponent: "flow-editor"): the session header (title from the
// instance's prompt), the chat window (chat-session) with the Save button,
// and a tabbed editing surface — the definition module and one editable tab
// per referenced file. This is the authoring session rendered as a flow
// instance: the definition's instance IS the editor.
//
// The editor is live and bidirectional: the agent's changes (source / files)
// appear as the session works, and the human's direct edits write back into
// instance state (throttled, ~800 ms debounce, flushed on send / save /
// disconnect). The definition module is the single artifact — the human's
// edits ARE the state (no divergence, no adoption). The Definition tab binds
// to the parsed definition object (server-parsed), so a structured-form panel
// can later replace or augment the raw literal without re-plumbing.

const WRITE_BACK_DEBOUNCE_MS = 800;

// Tab ids: "definition" is fixed; referenced files use their module-set path
// (e.g. "./gates/approved.ts") as the tab id.
const DEFINITION_TAB = "definition";

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

  // The active editing tab and the human's in-flight edits per tab,
  // overriding the bound value until the write-back round-trips (the
  // round-trip guard: a WS snapshot reflecting the shell's own patch must not
  // clear the user's typing).
  private activeTab: string = DEFINITION_TAB;
  private editedValues: Record<string, string> = {};
  private pendingWriteBacks: Map<string, string> = new Map();
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

    button.instantiate-btn {
      font-family: inherit;
      font-size: 0.625rem;
      height: 24px;
      padding: 0 0.5rem;
      border-radius: 4px;
      border: 1px solid var(--accent);
      background: transparent;
      color: var(--accent);
      cursor: pointer;
      flex: none;
    }

    button.instantiate-btn:hover {
      background: var(--accent);
      color: var(--bg);
    }

    .tab-bar {
      display: flex;
      gap: 0.25rem;
      flex-wrap: wrap;
    }

    button.tab {
      font-family: inherit;
      font-size: 0.625rem;
      height: 24px;
      padding: 0 0.5rem;
      border-radius: 4px 4px 0 0;
      border: 1px solid var(--border);
      border-bottom: none;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      max-width: 14rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    button.tab:hover {
      color: var(--text);
    }

    button.tab.active {
      background: var(--bg);
      color: var(--text);
      font-weight: 600;
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

    .pane-path {
      font-size: 0.625rem;
      color: var(--muted);
      overflow-wrap: anywhere;
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

    .diverged-actions {
      display: flex;
      gap: 0.375rem;
      align-items: center;
    }

  `;

  workflowDef: WorkflowDefResponse = null as unknown as WorkflowDefResponse;
  instanceEntry: WorkflowInstanceEntry =
    null as unknown as WorkflowInstanceEntry;
  customKinds: readonly CustomRenderKind[] = [];

  render() {
    const state = this.instanceEntry.state.workflowInstanceState;
    const sessionSource = typeof state.source === "string" ? state.source : "";
    const files = this.sessionFiles();
    const filePaths = Object.keys(files).sort();
    const activeTab = this.availableTab(filePaths);

    return html`
      <div class="editor">
        <div class="editor-header">
          <span class="editor-title">${this.sessionTitle()}</span>
        </div>
        ${this.renderChat(sessionSource)}
        <div class="tab-bar">
          <button
            class="tab ${activeTab === DEFINITION_TAB ? "active" : ""}"
            type="button"
            @click=${() => this.selectTab(DEFINITION_TAB)}
          >
            Definition
          </button>
          ${filePaths.map(
            (path) => html`<button
              class="tab ${activeTab === path ? "active" : ""}"
              type="button"
              title=${path}
              @click=${() => this.selectTab(path)}
            >
              ${path}
            </button>`
          )}
        </div>
        ${
          activeTab !== DEFINITION_TAB
            ? this.renderFilePane(
                activeTab,
                this.tabValue(activeTab, files[activeTab] ?? "")
              )
            : this.renderDefinitionPane(
                this.tabValue(DEFINITION_TAB, sessionSource),
                this.previewErrors()
              )
        }
      </div>
    `;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    // The round-trip guard: once a snapshot carries the exact value the human
    // typed in a tab (their own write-back echoed back), stop overriding the
    // display for that tab — future agent changes then show through normally.
    if (!changed.has("instanceEntry")) return;
    const state = this.instanceEntry.state.workflowInstanceState;
    const source = state.source;
    const files = this.sessionFiles();
    if (
      typeof source === "string" &&
      this.editedValues[DEFINITION_TAB] === source
    ) {
      delete this.editedValues[DEFINITION_TAB];
    }
    for (const [tab, edited] of Object.entries(this.editedValues)) {
      if (tab === DEFINITION_TAB) continue;
      if (files[tab] === edited) delete this.editedValues[tab];
    }
  }

  public override disconnectedCallback(): void {
    super.disconnectedCallback();
    // Flush any pending write-back when the editor unmounts (navigation).
    void this.flushWriteBack();
  }

  // ── tab surface ─────────────────────────────────────────────────────

  // The referenced files of the session's module set (relative path → source).
  // The tabs derive from the definition's declared refs (the agent writes the
  // files; a declared-but-unwritten ref still gets a tab), merged with the
  // files that already exist.
  private sessionFiles(): Record<string, string> {
    const files = this.instanceEntry.state.workflowInstanceState.files;
    const existing =
      files !== null && typeof files === "object" && !Array.isArray(files)
        ? (files as Record<string, string>)
        : {};
    const merged: Record<string, string> = {};
    for (const ref of this.definitionRefs()) {
      merged[ref] = existing[ref] ?? "";
    }
    for (const [path, source] of Object.entries(existing)) {
      if (!(path in merged)) merged[path] = source;
    }
    return merged;
  }

  // The referenced module paths the parsed definition declares (tool/op refs,
  // file gates, extractors, prompt refs, edge transforms). The parsed
  // definition is the server-parsed data object the Definition tab binds to.
  private definitionRefs(): string[] {
    const parsed = this.parsedDefinition();
    if (parsed === null) return [];
    const refs = new Set<string>();
    const addGate = (gate: unknown): void => {
      if (gate === null || typeof gate !== "object") return;
      const g = gate as {
        kind?: string;
        ref?: unknown;
        gate?: unknown;
        gates?: unknown;
      };
      if (g.kind === "file" && typeof g.ref === "string") {
        refs.add(g.ref);
        return;
      }
      if (g.kind === "not") addGate(g.gate);
      if (g.kind === "and" || g.kind === "or") {
        if (Array.isArray(g.gates)) for (const inner of g.gates) addGate(inner);
      }
    };
    const flow = parsed as Record<string, unknown>;
    const tools = Array.isArray(flow.tools) ? flow.tools : [];
    for (const tool of tools) {
      const ref = (tool as { ref?: unknown }).ref;
      if (typeof ref === "string") refs.add(ref);
    }
    const operations = Array.isArray(flow.operations) ? flow.operations : [];
    for (const op of operations) {
      const ref = (op as { ref?: unknown }).ref;
      if (typeof ref === "string") refs.add(ref);
    }
    const workflows = Array.isArray(flow.workflows) ? flow.workflows : [];
    for (const wf of workflows) {
      const states = Array.isArray((wf as { states?: unknown }).states)
        ? (wf as { states: unknown[] }).states
        : [];
      for (const state of states) {
        const tasks = Array.isArray((state as { tasks?: unknown }).tasks)
          ? (state as { tasks: unknown[] }).tasks
          : [];
        for (const task of tasks) {
          const t = task as {
            operations?: unknown;
            systemPromptRef?: unknown;
            extract?: { ref?: unknown };
          };
          const taskOps = Array.isArray(t.operations) ? t.operations : [];
          for (const op of taskOps) {
            if (op !== null && typeof op === "object") {
              const ref = (op as { ref?: unknown }).ref;
              if (typeof ref === "string") refs.add(ref);
            }
          }
          if (typeof t.systemPromptRef === "string")
            refs.add(t.systemPromptRef);
          if (t.extract && typeof t.extract.ref === "string") {
            refs.add(t.extract.ref);
          }
        }
        const transitions = Array.isArray(
          (state as { autoTransitions?: unknown }).autoTransitions
        )
          ? (state as { autoTransitions: { gate?: unknown }[] }).autoTransitions
          : [];
        for (const transition of transitions) addGate(transition.gate);
        const actions = Array.isArray((state as { actions?: unknown }).actions)
          ? (state as { actions: { gate?: unknown }[] }).actions
          : [];
        for (const action of actions) addGate(action.gate);
      }
    }
    const flowActions = Array.isArray(flow.actions) ? flow.actions : [];
    for (const action of flowActions) {
      addGate((action as { gate?: unknown }).gate);
    }
    const edges = Array.isArray(flow.edges) ? flow.edges : [];
    for (const edge of edges) {
      const transform = (edge as { transform?: { ref?: unknown } }).transform;
      if (transform && typeof transform.ref === "string")
        refs.add(transform.ref);
    }
    return [...refs].sort();
  }

  private previewErrors(): string[] {
    const errors = this.instanceEntry.state.workflowInstanceState.previewErrors;
    return Array.isArray(errors)
      ? errors.filter((error): error is string => typeof error === "string")
      : [];
  }

  // The effective value of a tab: the human's in-flight edit, else the bound
  // value.
  private tabValue(tab: string, bound: string): string {
    const edited = this.editedValues[tab];
    return edited !== undefined ? edited : bound;
  }

  // The active tab, falling back to the definition when it points at a file
  // the session no longer references.
  private availableTab(filePaths: string[]): string {
    if (this.activeTab === DEFINITION_TAB) return this.activeTab;
    return filePaths.includes(this.activeTab) ? this.activeTab : DEFINITION_TAB;
  }

  private selectTab(tab: string): void {
    this.activeTab = tab;
    this.requestUpdate();
  }

  private renderFilePane(path: string, value: string) {
    return html`<div class="pane">
      <div class="pane-head">
        <span class="pane-title">Referenced file</span>
        <span class="pane-path">${path}</span>
      </div>
      ${
        value === ""
          ? html`<p class="diverged-note"
              >Declared by the definition — not implemented yet. Ask the agent
              to write it (write_definition_file) and validate.</p
            >`
          : nothing
      }
      <code-editor
        .value=${value}
        @hive-code-change=${(event: CustomEvent<{ value: string }>) =>
          this.handleTabChange(path, event.detail.value)}
      ></code-editor>
    </div>`;
  }

  // The editable definition pane: the working module (the human's edits or
  // the agent's latest — one artifact), the validation draft notes, and the
  // parsed definition object the tab binds to (a structured-form panel can
  // replace or augment the raw literal without re-plumbing).
  private renderDefinitionPane(value: string, errors: string[]) {
    const parsed = this.parsedDefinition();
    return html`<div class="pane">
      <div class="pane-head">
        <span class="pane-title">Definition module (.ts)</span>
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
        @hive-code-change=${(event: CustomEvent<{ value: string }>) =>
          this.handleTabChange(DEFINITION_TAB, event.detail.value)}
      ></code-editor>
      ${
        parsed !== null
          ? html`<p class="diverged-note"
              >Definition data: ${JSON.stringify(parsed).slice(0, 120)}…</p
            >`
          : nothing
      }
    </div>`;
  }

  // The parsed definition object the Definition tab binds to (the server
  // parses the module on every source write-back); null when the current
  // source does not parse.
  private parsedDefinition(): { id?: string; label?: string } | null {
    const parsed =
      this.instanceEntry.state.workflowInstanceState.parsedDefinition;
    return parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
      ? (parsed as { id?: string; label?: string })
      : null;
  }

  // ── write-back (throttled) ──────────────────────────────────────────

  private handleTabChange = (tab: string, value: string): void => {
    this.pendingWriteBacks.set(tab, value);
    this.editedValues[tab] = value;
    if (this.writeBackTimer !== null) {
      window.clearTimeout(this.writeBackTimer);
    }
    this.writeBackTimer = window.setTimeout(
      () => void this.flushWriteBack(),
      WRITE_BACK_DEBOUNCE_MS
    );
    this.requestUpdate();
  };

  // Writes every pending tab snapshot into the session state: the definition
  // module (the edit IS the state) or a referenced file (authoritative).
  // Returns when the patches are in flight; save/send await it so the
  // definition being saved or reasoned about includes the human's latest text.
  private async flushWriteBack(): Promise<void> {
    if (this.writeBackTimer !== null) {
      window.clearTimeout(this.writeBackTimer);
      this.writeBackTimer = null;
    }
    const pending = this.pendingWriteBacks;
    this.pendingWriteBacks = new Map();
    for (const [tab, value] of pending) {
      if (tab === DEFINITION_TAB) {
        this.emitPatchState({ source: value });
      } else {
        this.emitPatchState({ files: { [tab]: value } });
      }
    }
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

  // ── session chrome ──────────────────────────────────────────────────

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
        ${
          savedId !== ""
            ? html`<button
                class="instantiate-btn"
                type="button"
                @click=${() => this.emitAction("instantiate", { id: savedId })}
              >
                Instantiate flow
              </button>`
            : nothing
        }
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

  // ── action / message forwarding ─────────────────────────────────────

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
