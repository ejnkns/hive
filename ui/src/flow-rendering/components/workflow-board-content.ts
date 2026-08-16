/** The canonical per-workflow grouped board/list, as a standalone element a
 * custom workflow view (WorkflowConfig.ui.workflowComponent) composes under
 * its own chrome — e.g. a frontier summary bar above the ticket board, or the
 * expedition map's list. Hosts the same rendering and styles as the generic
 * section; the custom view wires the callbacks to its WorkflowViewProps. */

import { css, html, LitElement } from "lit";
import type {
  WorkflowDefResponse,
  WorkflowInstanceEntry,
} from "workflow-engine/create-flow-runtime";
import type { CustomRenderKind } from "workflow-engine/workflow-types";
import {
  type BoardContentCallbacks,
  boardContentStyles,
  renderBoardContent,
} from "./workflow-instances/board-content.ts";

export class WorkflowBoardContent extends LitElement {
  static properties = {
    workflowDef: { attribute: false },
    entries: { attribute: false },
    customKinds: { attribute: false },
    onAction: { attribute: false },
    onSendMessage: { attribute: false },
    onPatchState: { attribute: false },
  };

  static styles = [
    css`
      :host {
        display: block;
      }
    `,
    boardContentStyles,
  ];

  workflowDef: WorkflowDefResponse | null = null;
  entries: WorkflowInstanceEntry[] = [];
  customKinds: readonly CustomRenderKind[] = [];
  onAction: BoardContentCallbacks["onAction"] | undefined = undefined;
  onSendMessage: BoardContentCallbacks["onSendMessage"] | undefined = undefined;
  onPatchState: BoardContentCallbacks["onPatchState"] | undefined = undefined;

  render() {
    const def = this.workflowDef;
    if (def === null) return html``;
    return renderBoardContent(def, this.entries, this.customKinds, {
      onAction: (instanceId, actionId, payload) => {
        this.onAction?.(instanceId, actionId, payload);
      },
      onSendMessage: (instanceId, content) => {
        this.onSendMessage?.(instanceId, content);
      },
      onPatchState: (instanceId, values) => {
        this.onPatchState?.(instanceId, values);
      },
    });
  }
}

customElements.define("workflow-board-content", WorkflowBoardContent);
