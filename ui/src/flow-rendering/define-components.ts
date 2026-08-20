/** @private — registers the default components and their render kinds. */

import "./components/item-header.ts";
import "./components/action-bar.ts";
import "./components/flow-overview.ts";
import "./components/flow-create-form.ts";
import "./components/config-field-form.ts";
import "./components/message-list.ts";
import "./components/chat-session.ts";
import "./components/agent-progress.ts";
import "./components/operation-status.ts";
import "./components/task-error-view.ts";
import "./components/markdown-view.ts";
import "./components/text-view.ts";
import "./components/card-view.ts";
import "./components/cards-view.ts";
import "./components/chips-view.ts";
import "./components/json-view.ts";
import "./components/workflow-instance-card.ts";
import "./components/workflow-instances.ts";
import "./components/workflow-board-content.ts";
import { CardView } from "./components/card-view.ts";
import { CardsView } from "./components/cards-view.ts";
import { ChipsView } from "./components/chips-view.ts";
import { FlowEditor } from "./components/flow-editor.ts";
import { JsonView } from "./components/json-view.ts";
import { MarkdownView } from "./components/markdown-view.ts";
import { TextView } from "./components/text-view.ts";
import {
  registerComponentRenderer,
  registerKindRenderer,
} from "./renderer-registry.ts";

// Defines every custom element and registers the built-in render kinds and
// instance components. Called once at app boot before any flow page renders.
export function defineFlowRenderingComponents(): void {
  // The authoring session renders as a flow instance (ui.instanceComponent
  // "flow-editor" on the flow-authoring workflow).
  registerComponentRenderer("flow-editor", FlowEditor);
  registerKindRenderer("markdown", MarkdownView);
  registerKindRenderer("text", TextView);
  registerKindRenderer("card", CardView);
  registerKindRenderer("cards", CardsView);
  registerKindRenderer("chips", ChipsView);
  registerKindRenderer("json", JsonView);
}
