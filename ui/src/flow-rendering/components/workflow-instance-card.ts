import { css, html, LitElement, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import type {
  WorkflowDefResponse,
  WorkflowInstanceEntry,
} from "workflow-engine/create-flow-runtime";
import {
  deriveAcrossDisplayValue,
  deriveDisplayValue,
} from "workflow-engine/derive-display";
import type {
  ChatMessage,
  CustomRenderKind,
  RuntimeRenderHint,
} from "workflow-engine/workflow-types";
import { type ResolvedRender, resolveRender } from "../contract-resolution";
import { getKindRenderer } from "../renderer-registry";
import { resolvePath } from "../resolve-path";
import "./config-field-form";
import type { ConfigFieldValue } from "./config-field-form";
import "./dynamic-element-host";
import { statePath } from "./workflow-instance-card/state-path";
import {
  markdownSource,
  outcomeError,
  outcomeStatus,
  outputCards,
  stringifyValue,
  summarizeOutput,
  type TaskOutcomeShape,
  toCardsViewItems,
} from "./workflow-instance-card/task-output";

type SerializedTaskDef = {
  id: string;
  label: string;
  render?: RuntimeRenderHint;
};

export class WorkflowInstanceCard extends LitElement {
  static properties = {
    workflowDef: { attribute: false },
    instanceEntry: { attribute: false },
    customKinds: { attribute: false },
    compact: { type: Boolean },
    // Reactive so the edit form toggles re-render when opened/closed.
    editing: { attribute: false },
  };

  // Callback props (the InstanceComponentProps contract). When provided they
  // replace event dispatch, so custom instance components and the default card
  // share one interface.
  onAction:
    | ((actionId: string, payload?: Record<string, unknown>) => void)
    | undefined = undefined;
  onSendMessage: ((content: string) => Promise<void>) | undefined = undefined;
  // The instance-edit submit path (optional — see InstanceComponentProps).
  onPatchState: ((values: Record<string, unknown>) => void) | undefined =
    undefined;

  // Reactive so the edit form toggles re-render.
  editing = false;

  static styles = css`
    :host {
      display: block;
    }

    .card {
      border: 1px solid var(--card-border, var(--border));
      border-radius: 8px;
      background: var(--surface);
      padding: 0.875rem 1rem;
      transition: opacity 0.15s;
    }

    :host([data-category="initial"]) .card {
      opacity: 0.65;
    }

    :host([data-category="terminal"]) .card {
      --card-border: var(--success);
    }

    :host([data-category="error"]) .card {
      --card-border: var(--error);
    }

    .body {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      margin-bottom: 0.75rem;
    }

    .state-path {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-bottom: 0.5rem;
    }

    .state-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--border);
    }

    .state-dot-active {
      background: var(--accent);
    }

    .state-dot-terminal {
      background: var(--success);
    }

    .state-dot-error {
      background: var(--error);
    }

    .state-dot[data-current="true"] {
      outline: 1px solid var(--text);
      outline-offset: 1px;
    }

    .task-panel {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.5rem;
      // A chat-heavy card (an authoring session, a requirements session) needs
      // room for a real conversation; cap by viewport so it never dominates.
      max-height: min(50vh, 420px);
      overflow-y: auto;
    }

    .task-outputs {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      font-size: 0.6875rem;
    }

    .outputs-label {
      color: var(--muted);
      font-weight: 700;
      font-size: 0.5625rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 0.125rem;
    }

    .output-item {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
      padding: 0.5rem 0.625rem;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
    }

    .output-head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .output-task-id {
      color: var(--accent);
      font-family: monospace;
      font-size: 0.6875rem;
    }

    .output-status {
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 600;
      font-size: 0.5625rem;
    }

    .output-status-success {
      color: var(--success);
    }

    .output-status-error {
      color: var(--error);
    }

    .domain-data {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
      font-size: 0.6875rem;
    }

    .domain-data-item {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      padding: 0.375rem 0;
      border-top: 1px solid var(--border);
    }

    .domain-data-item:first-child {
      border-top: none;
    }

    .domain-data-key {
      color: var(--accent);
      font-family: monospace;
      font-weight: 600;
    }

    .domain-data-value {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--text);
      font-family: var(--font-mono, monospace);
    }

    .domain-progress {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .domain-progress-text {
      font-size: 0.6875rem;
      color: var(--text);
    }

    .domain-progress-track {
      height: 6px;
      border-radius: 3px;
      background: var(--border);
      overflow: hidden;
    }

    .domain-progress-fill {
      height: 100%;
      border-radius: 3px;
      background: var(--accent);
      transition: width 0.2s;
    }

    .card-actions {
      margin-top: 0.25rem;
    }

    .edit-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.375rem;
    }

    button.edit-btn {
      font-family: inherit;
      font-size: 0.6875rem;
      height: 26px;
      padding: 0 0.625rem;
      border-radius: 5px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      cursor: pointer;
      transition: background 0.15s;
    }

    button.edit-btn:hover {
      background: var(--border);
    }
  `;

  // Lit reactive properties need a default value, but these are always set by
  // the parent before first paint; the null cast satisfies the initializer.
  workflowDef: WorkflowDefResponse = null as unknown as WorkflowDefResponse;
  instanceEntry: WorkflowInstanceEntry =
    null as unknown as WorkflowInstanceEntry;
  customKinds: readonly CustomRenderKind[] = [];
  compact = false;

  render() {
    const stateDef = this.workflowDef.states.find(
      (state) => state.id === this.instanceEntry.state.currentState
    );
    const category = stateDef?.category ?? "active";
    const isTerminal = this.workflowDef.terminalStates.includes(
      this.instanceEntry.state.currentState
    );

    return html`
      <div class="card">
        <item-header
          .title=${this.instanceTitle(stateDef?.label)}
          .subtitle=${this.resolveString(
            this.workflowDef.instance?.subtitle ?? ""
          )}
          .category=${category}
          .isTerminal=${isTerminal}
          .hasRunningTask=${this.instanceEntry.state.hasRunningTask}
          .description=${stateDef?.description ?? ""}
          .compact=${this.compact}
        ></item-header>
        ${this.renderStatePath()}
        ${this.compact ? nothing : this.renderBody()}
        ${this.renderActions()}
      </div>
    `;
  }

  private renderStatePath() {
    const path = statePath(
      this.instanceEntry.state.history,
      this.instanceEntry.state.currentState
    );
    if (path.length <= 1) return nothing;
    const categoryByState = new Map(
      this.workflowDef.states.map((state) => [
        state.id,
        state.category ?? "active",
      ])
    );
    return html`<div class="state-path">
      ${path.map((stateId) => {
        const current = stateId === this.instanceEntry.state.currentState;
        return html`<span
          class="state-dot state-dot-${categoryByState.get(stateId) ?? "active"}"
          data-current=${current ? "true" : "false"}
          title=${stateId}
        ></span>`;
      })}
    </div>`;
  }

  private renderBody() {
    return html`
      <div class="body">
        ${
          this.instanceEntry.state.hasRunningTask
            ? this.renderRunningTask()
            : this.renderTaskOutputs()
        }
        ${this.renderDomainData()}
      </div>
    `;
  }

  private renderRunningTask() {
    const ctx = this.instanceEntry.state.runningTaskContext;
    if (ctx === null) return nothing;
    return html`<div class="task-panel">
      ${
        ctx.role === "ai-chat"
          ? html`<chat-session
            .messages=${ctx.messages}
            .sessionId=${ctx.sessionId}
            .interactive=${ctx.interactive}
            .thinking=${this.agentIsThinking(ctx.messages)}
            .modelStatus=${ctx.modelStatus}
            @hive-send-message=${this.handleSendMessage}
          ></chat-session>`
          : ctx.role === "ai-task"
            ? html`<agent-progress .messages=${ctx.messages}></agent-progress>`
            : html`<operation-status></operation-status>`
      }
    </div>`;
  }

  // The agent is composing its next reply when the task is running and the
  // transcript ends on anything but an assistant message (a user message it
  // hasn't answered yet, or a tool result mid-loop).
  private agentIsThinking(messages: ChatMessage[]): boolean {
    if (!this.instanceEntry.state.hasRunningTask) return false;
    const last = messages[messages.length - 1];
    return last !== undefined && last.role !== "assistant";
  }

  private renderTaskOutputs() {
    const entries = Object.entries(this.instanceEntry.state.taskOutputs);
    if (entries.length === 0) return nothing;
    return html`<div class="task-outputs">
      <span class="outputs-label">Task outputs</span>
      ${repeat(
        entries,
        ([taskId]) => taskId,
        ([taskId, outcome]) => {
          const taskDef = this.findTaskDef(taskId);
          const status = outcomeStatus(outcome);
          const error = outcomeError(outcome);
          return html`<div class="output-item">
            <div class="output-head">
              <span class="output-task-id"
                >${taskDef?.label ?? taskId}</span
              >
              <span class="output-status output-status-${status}"
                >${status}</span
              >
            </div>
            ${
              error
                ? html`<task-error-view .error=${error}></task-error-view>`
                : nothing
            }
            ${this.renderTaskBody(taskDef, outcome)}
          </div>`;
        }
      )}
    </div>`;
  }

  private renderTaskBody(
    taskDef: SerializedTaskDef | undefined,
    outcome: unknown
  ) {
    // The wire outcome is untyped; only its optional fields are read.
    const taskOutcome = outcome as TaskOutcomeShape | null;
    if (taskOutcome?.status !== "success") return nothing;
    const output = taskOutcome.output;
    if (taskDef?.render) {
      const resolved = resolveRender({
        output,
        hint: taskDef.render,
        customKinds: this.customKinds,
      });
      return this.renderResolved(output, resolved);
    }
    const cards = outputCards(output);
    if (cards !== null && cards.length > 0) {
      return html`<cards-view .items=${toCardsViewItems(cards)}></cards-view>`;
    }
    const markdown = markdownSource(output);
    if (markdown !== null) {
      return html`<markdown-view .content=${markdown}></markdown-view>`;
    }
    const summary = summarizeOutput(output);
    if (summary === null) return nothing;
    return html`<text-view .content=${summary}></text-view>`;
  }

  private renderDomainData() {
    const instanceState = this.instanceEntry.state.workflowInstanceState;
    const display = this.workflowDef.display;
    if (display && display.fields.length > 0) {
      return html`<div class="domain-data">
        ${display.fields.map((field) => {
          const value = resolvePath(instanceState, field.path);
          const label = field.label ?? field.path;
          // A derived display computes a value from the resolved path
          // (count/progress/sum); when the derive cannot evaluate, the raw
          // value renders instead.
          const derived = field.derive
            ? field.derive.kind === "countAcross" ||
              field.derive.kind === "progressAcross"
              ? deriveAcrossDisplayValue(
                  field.derive,
                  field.path,
                  this.instanceEntry.workflowSummary ?? {
                    total: 0,
                    byField: {},
                  }
                )
              : deriveDisplayValue(field.derive, value)
            : undefined;
          const shown =
            derived !== undefined && derived.kind !== "progress"
              ? derived.value
              : value;
          return html`<div class="domain-data-item">
            <span class="domain-data-key">${label}</span>
            ${
              derived?.kind === "progress"
                ? this.renderProgress(derived.count, derived.total)
                : field.render
                  ? this.renderResolved(
                      shown,
                      resolveRender({
                        output: shown,
                        hint: field.render,
                        customKinds: this.customKinds,
                      })
                    )
                  : html`<pre class="domain-data-value"
                    >${stringifyValue(shown)}</pre
                  >`
            }
          </div>`;
        })}
      </div>`;
    }
    const entries = Object.entries(instanceState);
    if (entries.length === 0) return nothing;
    return html`<div class="domain-data">
      <span class="outputs-label">Session data</span>
      ${entries.map(
        ([key, value]) => html`<div class="domain-data-item">
          <span class="domain-data-key">${key}</span>
          <pre class="domain-data-value">${stringifyValue(value)}</pre>
        </div>`
      )}
    </div>`;
  }

  // A progress derive renders as a small bar with "count of total".
  private renderProgress(count: number, total: number) {
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    return html`<div class="domain-progress">
      <span class="domain-progress-text">${count} of ${total}</span>
      <div class="domain-progress-track">
        <div
          class="domain-progress-fill"
          style="width: ${pct}%"
        ></div>
      </div>
    </div>`;
  }

  private renderResolved(output: unknown, resolved: ResolvedRender) {
    const renderer = getKindRenderer(resolved.kind);
    if (renderer === undefined) {
      return html`<json-view .value=${output}></json-view>`;
    }
    return html`<dynamic-element-host
      .elementClass=${renderer}
      .props=${resolved.props}
    ></dynamic-element-host>`;
  }

  private renderActions() {
    const actions = [...this.instanceEntry.availableActions].sort(
      byVariantPriority
    );
    const editFields = this.instanceEntry.editFields ?? [];
    if (actions.length === 0 && editFields.length === 0) return nothing;
    return html`<div class="card-actions">
      ${
        this.editing
          ? html`<config-field-form
              .fields=${editFields}
              .values=${this.editPrefill()}
              .submitLabel=${"Save"}
              @hive-fields-submit=${this.handleEditSubmit}
              @hive-fields-cancel=${() => (this.editing = false)}
            ></config-field-form>`
          : html`<div class="edit-row">
              <action-bar
                .actions=${actions}
                @hive-action=${this.handleAction}
              ></action-bar>
              ${
                editFields.length > 0
                  ? html`<button
                      class="edit-btn"
                      type="button"
                      @click=${() => (this.editing = true)}
                    >
                      Edit details
                    </button>`
                  : nothing
              }
            </div>`
      }
    </div>`;
  }

  // Pre-fill the edit form from the instance's current state — only for
  // values shaped like the declared field types (the form's value type is
  // scalar/array; an object the agent wrote under a listed key is skipped so
  // the patch cannot echo it back).
  private editPrefill(): Record<string, ConfigFieldValue> {
    const state = this.instanceEntry.state.workflowInstanceState;
    const result: Record<string, ConfigFieldValue> = {};
    for (const field of this.instanceEntry.editFields ?? []) {
      const value = state[field.key];
      if (
        typeof value === "string" ||
        typeof value === "boolean" ||
        typeof value === "number" ||
        Array.isArray(value)
      ) {
        result[field.key] = value as ConfigFieldValue;
      }
    }
    return result;
  }

  private handleEditSubmit = (
    event: CustomEvent<{ values: Record<string, ConfigFieldValue> }>
  ) => {
    this.editing = false;
    this.emitPatchState(event.detail.values);
  };

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

  private findTaskDef(taskId: string): SerializedTaskDef | undefined {
    for (const state of this.workflowDef.states) {
      const task = state.tasks?.find((t) => t.id === taskId);
      if (task !== undefined) return task;
    }
    return undefined;
  }

  private instanceTitle(stateLabel: string | undefined): string {
    return (
      this.resolveString(this.workflowDef.instance?.title ?? "") ??
      stateLabel ??
      this.instanceEntry.state.currentState
    );
  }

  private resolveString(path: string): string | undefined {
    if (path === "") return undefined;
    const value = resolvePath(
      this.instanceEntry.state.workflowInstanceState,
      path
    );
    return typeof value === "string" ? value : undefined;
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
    // Same as handleAction: the chat-session event carries no ids.
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

customElements.define("workflow-instance-card", WorkflowInstanceCard);

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
