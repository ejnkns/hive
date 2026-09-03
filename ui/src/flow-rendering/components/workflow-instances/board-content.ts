/** The canonical per-workflow grouped renderer: the flat list or the
 * state-column board (columns / groupByField / state order), with
 * flow-declared custom instance components replacing the default card. Shared
 * by the workflow-instances section (renders inline, so its existing grouping
 * tests keep passing) and the standalone <workflow-board-content> element a
 * custom workflow view composes under its own chrome. */

import { type CSSResult, css, html, type TemplateResult } from "lit";
import { repeat } from "lit/directives/repeat.js";
import type {
  WorkflowDefResponse,
  WorkflowInstanceEntry,
} from "workflow-engine/create-flow-runtime";
import type { CustomRenderKind } from "workflow-engine/workflow-types";
import { getComponentRenderer } from "../../renderer-registry.ts";
import { WorkflowInstanceCard } from "../workflow-instance-card.ts";
import { groupInstancesByColumns } from "./group-by-columns.ts";
import { groupInstancesByField } from "./group-by-field.ts";
import { groupInstancesByState } from "./group-by-state.ts";

// The structural column shape the grouping modules return; declared locally
// so the renderer does not import a type from a private grouping module.
export type BoardColumn = {
  id: string;
  label: string;
  category: string;
  entries: WorkflowInstanceEntry[];
};

// The callbacks the renderer wires to each instance card. The section passes
// its event emitters; the standalone element forwards them as its own
// hive-* events.
export type BoardContentCallbacks = {
  onAction(
    instanceId: string,
    actionId: string,
    payload?: Record<string, unknown>
  ): void;
  onSendMessage(instanceId: string, content: string): void;
  onPatchState(instanceId: string, values: Record<string, unknown>): void;
};

// The board/list content styles. Hosted by both the workflow-instances
// section (which renders the content inline in its shadow root) and the
// standalone <workflow-board-content> element.
export const boardContentStyles: CSSResult = css`
  .flow-board {
    gap: 0.625rem;
    padding-top: 0.625rem;
  }

  .flow-list {
    gap: 0.625rem;
    padding-top: 0.625rem;
  }

  .board-column {
    min-width: 200px;
    max-width: 300px;
    gap: 0.5rem;
  }

  .board-column[data-empty="true"] {
    min-width: 150px;
    opacity: 0.45;
  }

  .column-header {
    gap: 0.375rem;
    padding: 0.375rem 0.5rem;
    font-size: 0.5625rem;
    letter-spacing: 0.06em;
  }

  .column-header[data-category="initial"] {
    color: var(--muted);
  }

  .column-header[data-category="terminal"] {
    color: var(--success);
    border-color: var(--success);
  }

  .column-header[data-category="error"] {
    color: var(--error);
    border-color: var(--error);
  }

  .column-count {
    margin-left: auto;
    font-family: monospace;
  }

  .column-body {
    gap: 0.5rem;
  }
`;

// The canonical grouped render: the flat list for non-board views, otherwise
// the board — field-value partition when the definition declares groupByField
// (E3 — the generic engine partitions; it never interprets values), curated
// columns when the definition declares them (the definition renders its
// canonical lanes), otherwise the default derived board (one column per
// state). Custom workflow-instance components resolve through the registry.
export function renderBoardContent(
  def: WorkflowDefResponse,
  entries: WorkflowInstanceEntry[],
  customKinds: readonly CustomRenderKind[],
  callbacks: BoardContentCallbacks
): TemplateResult {
  const flatView = def.ui?.view !== undefined && def.ui.view !== "board";
  return flatView
    ? html`<div class="flow-list flex flex-col">
        ${repeat(
          entries,
          (entry) => entry.id,
          (entry) => renderInstance(def, entry, customKinds, callbacks)
        )}
      </div>`
    : html`<div class="flow-board flex items-start overflow-x-auto">
        ${groupBoard(def, entries).map((column) =>
          renderColumn(def, column, customKinds, callbacks)
        )}
      </div>`;
}

function groupBoard(
  def: WorkflowDefResponse,
  entries: WorkflowInstanceEntry[]
): BoardColumn[] {
  const groupByField = def.ui?.groupByField;
  if (groupByField !== undefined) {
    return groupInstancesByField(groupByField, entries);
  }
  const columns = def.ui?.columns;
  if (columns !== undefined && columns.length > 0) {
    return groupInstancesByColumns(def.states, columns, entries);
  }
  return groupInstancesByState(def.states, entries);
}

function renderColumn(
  def: WorkflowDefResponse,
  column: BoardColumn,
  customKinds: readonly CustomRenderKind[],
  callbacks: BoardContentCallbacks
) {
  return html`<div
    class="board-column flex-1 flex flex-col"
    data-category=${column.category}
    data-empty=${column.entries.length === 0 ? "true" : "false"}
  >
    <div class="column-header flex items-center border bg-bg font-bold uppercase rounded-md" data-category=${column.category}>
      <span class="column-label">${column.label}</span>
      <span class="column-count text-muted">${column.entries.length}</span>
    </div>
    ${
      column.entries.length > 0
        ? html`<div class="column-body flex flex-col">
          ${repeat(
            column.entries,
            (entry) => entry.id,
            (entry) => renderInstance(def, entry, customKinds, callbacks)
          )}
        </div>`
        : ""
    }
  </div>`;
}

function renderInstance(
  def: WorkflowDefResponse,
  entry: WorkflowInstanceEntry,
  customKinds: readonly CustomRenderKind[],
  callbacks: BoardContentCallbacks
) {
  const customComponent = getComponentRenderer(def.ui?.instanceComponent);
  const component = customComponent ?? WorkflowInstanceCard;
  return html`<dynamic-element-host
    .elementClass=${component}
    .props=${{
      workflowDef: def,
      instanceEntry: entry,
      customKinds,
      onAction: (actionId: string, payload?: Record<string, unknown>) => {
        callbacks.onAction(entry.id, actionId, payload);
      },
      onSendMessage: (content: string) => {
        callbacks.onSendMessage(entry.id, content);
      },
      onPatchState: (values: Record<string, unknown>) => {
        callbacks.onPatchState(entry.id, values);
      },
    }}
  ></dynamic-element-host>`;
}
