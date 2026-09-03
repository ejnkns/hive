/** The shared expedition decorator + story matrix: every wayfinder visual
 * story renders inside the same chrome the served host composes (the theme
 * wrapper with its per-theme --wf-* variables) and across the same
 * theme × light/dark × width matrix. The matrix is expressed as Chromatic
 * MODES — named combinations of Storybook globals (theme, mode, viewport);
 * Chromatic snapshots a story once per applied mode, with independent
 * baselines. See
 * docs/decisions/2026-09-03-visual-testing-chromatic-replaces-percy.md. */

import type { Decorator } from "@storybook/web-components-vite";
import { html, type TemplateResult } from "lit";
import type { ExpeditionTheme } from "presets/wayfinder/ui/wayfinder-themes";
import {
  installReducedMotionEmulation,
  uninstallReducedMotionEmulation,
} from "./reduced-motion.ts";

export type ExpeditionMode = "dark" | "light";

// The declared matrix story args (theme x mode). Stories annotate their
// render parameter with this type so the matrix axes are compile-checked;
// the VALUES arrive as Storybook globals (preview.ts globalTypes — driven
// by Chromatic modes during captures and the dev toolbar locally), bridged
// onto args by the decorators below.
export type MatrixArgs = { theme: ExpeditionTheme; mode: ExpeditionMode };

// The args/axes type for surfaces with no expedition axis at all (the
// default flow components render in the hive app shell, not the expedition
// chrome): light/dark only.
export type ModeArgs = { mode: ExpeditionMode };

// The matrix axes as const lists — the single source the preview's
// globalTypes toolbar and the mode sets below both derive from.
export const expeditionThemes = ["mountain", "topo", "stars"] as const;
export const expeditionModesList = ["dark", "light"] as const;

// The width axis: the named Storybook viewports the mode globals reference
// (Chromatic captures each mode at its viewport global; the height is the
// common stage canvas the 480–560px story stages sit in).
export const expeditionViewports = {
  narrow: { name: "narrow (480)", styles: { width: "480px", height: "800px" } },
  medium: { name: "medium (900)", styles: { width: "900px", height: "800px" } },
  wide: { name: "wide (1280)", styles: { width: "1280px", height: "800px" } },
} as const;

// The expedition mode set — 3 themes × light/dark × 3 widths (18 modes):
// the same matrix shape the Percy configuration produced (its per-build
// widths × per-story additionalSnapshots). Applied at the meta level of
// every expedition-chrome story.
export const expeditionModeSet = Object.fromEntries(
  expeditionThemes.flatMap((theme) =>
    expeditionModesList.flatMap((mode) =>
      Object.keys(expeditionViewports).map((viewport) => [
        `${theme} ${mode} ${viewport}`,
        { theme, mode, viewport },
      ])
    )
  )
);

// The mode-only set for theme-INERT surfaces (components that read no
// expedition `--wf-*` variable — the card family, queen-bee's idea card, and
// the default flow components): a theme snapshot would duplicate the same
// pixels under a second name, so those stories vary light/dark × widths
// only (6 modes), and the preview's theme toolbar is their only theme
// control (disabled per meta where it would promise a change that cannot
// happen).
export const modeOnlyModeSet = Object.fromEntries(
  expeditionModesList.flatMap((mode) =>
    Object.keys(expeditionViewports).map((viewport) => [
      `${mode} ${viewport}`,
      { mode, viewport },
    ])
  )
);

/** Bridges the active theme/mode GLOBALS (preview.ts globalTypes — driven
 * by Chromatic modes during captures and the dev toolbar locally) onto the
 * story's args, which the typed renders consume. Globals win
 * unconditionally: they always carry defaults, so the story args never
 * carry the axes themselves. */
function applyMatrixGlobals(context: Parameters<Decorator>[1]): void {
  const { theme, mode } = context.globals;
  context.args = { ...context.args, theme, mode };
}

/** The mode + reduced-motion half of the matrix decorator, without the
 * expedition chrome: applies the story's light/dark mode (the served
 * components key their light palette off `:host-context(html.light)`, so the
 * mode must live on an ancestor — the preview iframe's documentElement is
 * the served host's `html`; set, not toggled, so the mode is correct
 * regardless of story order — Chromatic boots each capture in a fresh
 * standardized browser) and emulates prefers-reduced-motion for the story's
 * mount (see reduced-motion.ts — the canvas twinkle and the controller's
 * read-once matchMedia are JS-side concerns Chromatic's animation pausing
 * does not reach, so the controller's read-once seam is the lever that
 * makes every canvas-bearing snapshot deterministic). Reduced motion is on
 * by default for every story (preview.ts); per animated surface, explicit
 * "reduced motion" stories keep the accessibility behaviour a reviewed
 * artifact. Used directly by the default flow-component stories, which
 * render in the hive app shell's token context, not the expedition chrome. */
export const withMode: Decorator = (Story, context) => {
  applyMatrixGlobals(context);
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
    // story (Chromatic's captures boot each snapshot fresh, where the
    // restore is harmless either way).
    requestAnimationFrame(() => {
      setTimeout(uninstallReducedMotionEmulation, 100);
    });
  }
  return Story();
};

/** The wayfinder matrix decorator: the mode + reduced-motion handling plus
 * the expedition chrome (expedition-chrome.css) — the theme wrapper the
 * served host composes, with the per-theme --wf-* variables and
 * --map-backdrop keyed off the story's theme global. */
export const withExpedition: Decorator = (Story, context) => {
  const themed = withMode(Story, context);
  // globalTypes guarantee the theme global is an ExpeditionTheme (the
  // toolbar and the mode set both derive from expeditionThemes); the read
  // narrows the untyped globals record at this one seam.
  const theme = context.globals.theme as ExpeditionTheme;
  return html`<div class="expedition-chrome" data-theme=${theme}>
    ${themed}
  </div>`;
};

/** Applies the story's light/dark mode on the document element. The served
 * components key their light palette off `:host-context(html.light)`, so the
 * mode must live on an ancestor; the preview iframe's documentElement is the
 * served host's `html`. */
function applyMode(mode: ExpeditionMode): void {
  document.documentElement.classList.toggle("light", mode === "light");
}

/** A story body that needs an explicit height (the map canvas sizes to its
 * container). */
export function storyStage(
  content: TemplateResult,
  height = 480
): TemplateResult {
  return html`<div style="width: 100%; height: ${height}px">${content}</div>`;
}
