/** The queen-bee idea card (idea-card): proof the visual-matrix harness is
 * engine-generic, not wayfinder-shaped — a second preset's served component
 * mounted with the same FlowComponentDeps composition, the same fixture
 * discipline, and its own story. */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { html } from "lit";
import ideaCardModule from "presets/queen-bee/ideas/idea-card";
import { entry } from "ui/flow-rendering/test-fixtures";
import type { WorkflowInstanceEntry } from "workflow-engine/create-flow-runtime";
import type { VisibleAction } from "workflow-engine/workflow-types";
import {
  expeditionArgs,
  modeOnlyMatrix,
  themeInertArgTypes,
  withExpedition,
} from "./expedition-chrome.ts";
import { servedComponent } from "./flow-deps.ts";
import { instanceCardProps } from "./wayfinder-props.ts";

const IdeaCard = servedComponent(ideaCardModule, "idea-card");

// The queen-bee ideas workflow shape (fixture-local; the ideas definition is
// generated at runtime by the preset, so the story pins the states it
// presents).
const ideasDef = {
  id: "ideas",
  label: "Ideas",
  instance: { title: "title" },
  states: [
    { id: "new", label: "New", category: "initial" as const, actions: [] },
    {
      id: "elaborating",
      label: "Elaborating",
      category: "active" as const,
      actions: [],
    },
    {
      id: "specified",
      label: "Specified",
      category: "terminal" as const,
      actions: [],
    },
  ],
  initial: "new",
  terminalStates: ["specified"],
};

function ideaCard(options: {
  id: string;
  currentState: string;
  title: string;
  elaboratedSpec?: string;
  actions?: VisibleAction[];
  chat?: boolean;
}) {
  const idea: WorkflowInstanceEntry = entry(options.id, options.currentState);
  idea.workflowId = "ideas";
  idea.state.workflowInstanceState = { title: options.title };
  if (options.elaboratedSpec !== undefined) {
    idea.state.taskOutputs.elaborate = {
      status: "success",
      output: { elaboratedSpec: options.elaboratedSpec },
    };
  }
  if (options.chat === true) {
    idea.state.hasRunningTask = true;
    idea.state.runningTaskContext = {
      role: "ai-chat",
      sessionId: `${options.id}-chat`,
      interactive: true,
      messages: [
        { role: "assistant", content: "What problem does this idea solve?" },
        { role: "user", content: "Context loss between sessions." },
      ],
    };
  }
  idea.availableActions = options.actions ?? [];
  const card = new IdeaCard();
  Object.assign(card, instanceCardProps({ def: ideasDef, entry: idea }));
  return card;
}

const meta = {
  title: "Queen Bee/Idea card",
  decorators: [withExpedition],
  args: expeditionArgs,
  // The idea card reads the base hive tokens only (it never reads the
  // wayfinder --wf-* variables), so its matrix is light/dark × widths — no
  // per-theme snapshots, and the theme control is hidden.
  argTypes: themeInertArgTypes,
  parameters: { percy: { additionalSnapshots: modeOnlyMatrix } },
} satisfies Meta<{ mode: "dark" | "light" }>;

export default meta;
type Story = StoryObj<{ mode: "dark" | "light" }>;

export const New: Story = {
  name: "new idea",
  render: () =>
    html`${ideaCard({
      id: "idea-card-new",
      currentState: "new",
      title: "Session memory ledger",
      actions: [{ id: "elaborate", label: "Elaborate", variant: "primary" }],
    })}`,
};

export const Elaborating: Story = {
  name: "elaborating (live chat)",
  render: () =>
    html`${ideaCard({
      id: "idea-card-chat",
      currentState: "elaborating",
      title: "Session memory ledger",
      chat: true,
    })}`,
};

export const Specified: Story = {
  name: "specified",
  render: () =>
    html`${ideaCard({
      id: "idea-card-specified",
      currentState: "specified",
      title: "Session memory ledger",
      elaboratedSpec:
        "Persist a per-session memory ledger the elaborator reads back before each idea pass.",
    })}`,
};
