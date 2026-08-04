import { css, html, LitElement, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import type {
  WorkflowDefResponse,
  WorkflowInstanceEntry,
} from "workflow-engine/create-flow-runtime";
import type {
  CustomRenderKind,
  RuntimeRenderHint,
} from "workflow-engine/workflow-types";
import { type ResolvedRender, resolveRender } from "../contract-resolution";
import { getKindRenderer } from "../renderer-registry";
import { resolvePath } from "../resolve-path";
import "./dynamic-element-host";
import type { CardsViewItem } from "./cards-view";

type TaskOutcomeShape = {
  status?: string;
  error?: string;
  output?: unknown;
};

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
  };

  // Callback props (the InstanceComponentProps contract). When provided they
  // replace event dispatch, so custom instance components and the default card
  // share one interface.
  onAction: ((actionId: string) => void) | undefined = undefined;
  onSendMessage: ((content: string) => Promise<void>) | undefined = undefined;

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

    .task-panel {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.5rem;
      max-height: 220px;
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

    .card-actions {
      margin-top: 0.25rem;
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
        ${this.compact ? nothing : this.renderBody()}
        ${this.renderActions()}
      </div>
    `;
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
            @hive-send-message=${this.handleSendMessage}
          ></chat-session>`
          : ctx.role === "ai-task"
            ? html`<agent-progress .messages=${ctx.messages}></agent-progress>`
            : html`<operation-status></operation-status>`
      }
    </div>`;
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
          return html`<div class="domain-data-item">
            <span class="domain-data-key">${label}</span>
            ${
              field.render
                ? this.renderResolved(
                    value,
                    resolveRender({
                      output: value,
                      hint: field.render,
                      customKinds: this.customKinds,
                    })
                  )
                : html`<pre class="domain-data-value"
                  >${stringifyValue(value)}</pre
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
    const actions = this.instanceEntry.availableActions;
    if (actions.length === 0) return nothing;
    return html`<div class="card-actions">
      <action-bar
        .actions=${actions}
        @hive-action=${this.handleAction}
      ></action-bar>
    </div>`;
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

  private handleAction = (event: CustomEvent<{ actionId: string }>) => {
    this.emitAction(event.detail.actionId);
  };

  private handleSendMessage = (event: CustomEvent<{ content: string }>) => {
    this.emitSendMessage(event.detail.content);
  };

  private emitAction(actionId: string): void {
    if (this.onAction !== undefined) {
      this.onAction(actionId);
      return;
    }
    this.dispatchEvent(
      new CustomEvent("hive-action", {
        detail: { instanceId: this.instanceEntry.id, actionId },
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

// ── task-output helpers ──
//
// Task outputs arrive from the wire as unknown; the casts below read the few
// optional fields the default (no-hint) rendering understands. Each reader
// guards its own null/non-object/typeof checks, so a malformed shape degrades
// to an empty render rather than a crash.

function outcomeStatus(outcome: unknown): string {
  const status = (outcome as TaskOutcomeShape | null)?.status;
  return typeof status === "string" ? status : "unknown";
}

function outcomeError(outcome: unknown): string | null {
  const error = (outcome as TaskOutcomeShape | null)?.error;
  return typeof error === "string" && error !== "" ? error : null;
}

function outputCards(output: unknown): unknown[] | null {
  if (output === null || typeof output !== "object") return null;
  const cards = (output as Record<string, unknown>).cards;
  return Array.isArray(cards) ? cards : null;
}

function summarizeOutput(output: unknown): string | null {
  if (typeof output === "string") return truncate(output, 2000);
  if (output === null || output === undefined) return null;
  if (typeof output !== "object") return String(output);
  const content = (output as Record<string, unknown>).content;
  if (typeof content === "string") return truncate(content, 2000);
  return truncate(JSON.stringify(output, null, 2), 2000);
}

function toCardsViewItems(cards: unknown[]): CardsViewItem[] {
  return cards.map((card) => {
    if (card === null || typeof card !== "object") return {};
    const record = card as Record<string, unknown>;
    const bullets = Array.isArray(record.bullets)
      ? record.bullets
      : Array.isArray(record.acceptanceCriteria)
        ? record.acceptanceCriteria
        : [];
    return {
      title: typeof record.title === "string" ? record.title : undefined,
      description:
        typeof record.description === "string" ? record.description : undefined,
      bullets: bullets.filter((item) => typeof item === "string"),
    };
  });
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  return truncate(JSON.stringify(value, null, 2), 2000);
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}
