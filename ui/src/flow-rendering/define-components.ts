/** @private — registers the default components and their render kinds. */

import "./components/item-header";
import "./components/action-bar";
import "./components/message-list";
import "./components/chat-session";
import "./components/agent-progress";
import "./components/operation-status";
import "./components/task-error-view";
import "./components/markdown-view";
import "./components/text-view";
import "./components/card-view";
import "./components/cards-view";
import "./components/json-view";
import "./components/workflow-instance-card";
import "./components/workflow-instances";
import { CardView } from "./components/card-view";
import { CardsView } from "./components/cards-view";
import { JsonView } from "./components/json-view";
import { MarkdownView } from "./components/markdown-view";
import { TextView } from "./components/text-view";
import { registerKindRenderer } from "./renderer-registry";

// Defines every custom element and registers the built-in render kinds. Called
// once at app boot before any flow page renders.
export function defineFlowRenderingComponents(): void {
  registerKindRenderer("markdown", MarkdownView);
  registerKindRenderer("text", TextView);
  registerKindRenderer("card", CardView);
  registerKindRenderer("cards", CardsView);
  registerKindRenderer("json", JsonView);
}
