import type { FlowTheme } from "../flow-api.ts";

/** @public — flow theme application: a definition's declarative theme tokens
 * → the scoped CSS-variable declarations a flow page/card sets on its root
 * element. Three vars land wherever a theme is active; all flow-page accent
 * usage reads them through `var(--flow-accent, var(--accent))` (etc.), so no
 * theme ⇒ identical to today's global golden accent.
 *
 * Contrast is the renderer's job: one accent → rgb + a mixed on-accent. Both
 * themes fall out of the single value because the color-mix runs against the
 * active theme's --text/surfaces. */
export function themeVars(theme: FlowTheme | null | undefined): string {
  const accent = theme?.accent;
  if (accent === undefined || !/^#[0-9a-fA-F]{6}$/.test(accent)) return "";
  const r = parseInt(accent.slice(1, 3), 16);
  const g = parseInt(accent.slice(3, 5), 16);
  const b = parseInt(accent.slice(5, 7), 16);
  return [
    `--flow-accent: ${accent};`,
    `--flow-accent-rgb: ${r}, ${g}, ${b};`,
    // Readable-ish text on accent fills (hover states): mix the accent toward
    // the active theme's text. Best effort, not WCAG-verified (accepted, Q5).
    `--flow-on-accent: color-mix(in srgb, var(--flow-accent) 30%, var(--text));`,
  ].join(" ");
}
