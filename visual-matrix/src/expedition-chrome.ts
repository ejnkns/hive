/** The shared expedition decorator + story matrix: every wayfinder visual
 * story renders inside the same chrome the served host composes (the theme
 * wrapper with its per-theme --wf-* variables) and across the same
 * theme × light/dark matrix (Percy widths provide the narrow/medium/wide
 * axis). See docs/decisions/2026-09-01-visual-testing-storybook-percy.md. */

import type { Decorator } from "@storybook/web-components-vite";
import { html, type TemplateResult } from "lit";
import type { ExpeditionTheme } from "presets/wayfinder/ui/wayfinder-themes";
import {
  installReducedMotionEmulation,
  uninstallReducedMotionEmulation,
} from "./reduced-motion.ts";

export type ExpeditionMode = "dark" | "light";

// The declared matrix story args (theme x mode). Stories annotate their
// render parameter with this type so the matrix axes are compile-checked.
export type MatrixArgs = { theme: ExpeditionTheme; mode: ExpeditionMode };

// The story-level matrix axes. `theme` and `mode` are declared story args so
// Percy's additionalSnapshots can address them via the args URL param.
export const expeditionArgTypes = {
  theme: {
    control: "radio",
    options: ["mountain", "topo", "stars"],
  },
  mode: { control: "radio", options: ["dark", "light"] },
} as const;

// The matrix defaults: mountain dark is every story's own snapshot; the
// remaining five combos are Percy additionalSnapshots (suffix-named).
export const expeditionArgs: MatrixArgs = {
  theme: "mountain",
  mode: "dark",
};

export const expeditionMatrix = (
  [
    ["topo", "dark"],
    ["stars", "dark"],
    ["mountain", "light"],
    ["topo", "light"],
    ["stars", "light"],
  ] as const
).map(([theme, mode]) => ({
  suffix: ` (${theme} ${mode})`,
  args: { theme, mode },
}));

// The mode-only matrix for theme-INERT surfaces (components that read no
// expedition `--wf-*` variable — the card family and the default flow
// components): a theme snapshot would duplicate the same pixels under a
// second name, so those stories vary light/dark only and their meta hides
// the theme control (noInline: the dead control would only promise a change
// that cannot happen).
export const modeOnlyMatrix = [{ suffix: " (light)", args: { mode: "light" } }];

export const themeInertArgTypes = {
  ...expeditionArgTypes,
  theme: {
    ...expeditionArgTypes.theme,
    control: false,
    table: { disable: true },
  },
} as const;

// The args/argTypes for surfaces with no expedition axis at all (the default
// flow components render in the hive app shell, not the expedition chrome):
// light/dark only.
export type ModeArgs = { mode: ExpeditionMode };
export const modeOnlyArgs: ModeArgs = { mode: "dark" };
export const modeArgTypes = {
  mode: { control: "radio", options: ["dark", "light"] },
} as const;

/** Applies the story's light/dark mode on the document element. The served
 * components key their light palette off `:host-context(html.light)`, so the
 * mode must live on an ancestor; the preview iframe's documentElement is the
 * served host's `html`. Set (not toggled) per story render so the mode is
 * correct regardless of story order — Percy reuses one page across
 * snapshots. */
function applyMode(mode: ExpeditionMode): void {
  document.documentElement.classList.toggle("light", mode === "light");
}

/** The mode + reduced-motion half of the matrix decorator, without the
 * expedition chrome: applies the story's light/dark mode (the served
 * components key their light palette off `:host-context(html.light)`, so the
 * mode must live on an ancestor — the preview iframe's documentElement is the
 * served host's `html`; set, not toggled, so the mode is correct regardless
 * of story order) and emulates prefers-reduced-motion for the story's mount
 * (see reduced-motion.ts — Percy's browser has no media emulation, so the
 * controller's read-once matchMedia seam is the lever that makes every
 * canvas-bearing snapshot deterministic). Reduced motion is on by default for
 * every story (preview.ts); per animated surface, explicit "reduced motion"
 * stories keep the accessibility behaviour a reviewed artifact. Used
 * directly by the default flow-component stories, which render in the hive
 * app shell's token context, not the expedition chrome. */
export const withMode: Decorator = (Story, context) => {
  const mode = context.args.mode as ExpeditionMode;
  applyMode(mode);
  const reducedMotion =
    (context.parameters.expedition as { reducedMotion?: boolean } | undefined)
      ?.reducedMotion ?? true;
  if (reducedMotion) {
    installReducedMotionEmulation();
    // Restore after the story's first frame: the controller reads the media
    // query once per mount (firstUpdated), so an already-mounted surface
    // stays frozen; dev mode must not leak the emulation into the next
    // story (Percy's JS-enabled captures boot each snapshot fresh, where
    // the restore is harmless either way).
    requestAnimationFrame(() => {
      setTimeout(uninstallReducedMotionEmulation, 100);
    });
  }
  return Story();
};

/** The wayfinder matrix decorator: the mode + reduced-motion handling plus
 * the expedition chrome (expedition-chrome.css) — the theme wrapper the
 * served host composes, with the per-theme --wf-* variables and
 * --map-backdrop keyed off the story's theme arg. */
export const withExpedition: Decorator = (Story, context) => {
  const themed = withMode(Story, context);
  const theme = context.args.theme as ExpeditionTheme;
  return html`<div class="expedition-chrome" data-theme=${theme}>
    ${themed}
  </div>`;
};

/** A story body that needs an explicit height (the map canvas sizes to its
 * container). */
export function storyStage(
  content: TemplateResult,
  height = 480
): TemplateResult {
  return html`<div style="width: 100%; height: ${height}px">${content}</div>`;
}
