/** The wayfinder expedition themes (module-set sibling of the served flow
 * component): the skin data — theme ids, glyphs, accents, and config
 * resolution — shared by the entry (mini-map, theme getter) and the drawing
 * builders (pure, so they take the theme as a parameter rather than reading
 * component state). */

export type ExpeditionTheme = "mountain" | "topo" | "stars";

export const EXPEDITION_THEMES: readonly ExpeditionTheme[] = [
  "mountain",
  "topo",
  "stars",
];

// Glyphs are single-codepoint dingbats, never emoji (the repo's no-emoji
// rule). The fog node is always a "?" — a crisp question mark sitting on top
// of the visible fog region.
export const THEME_GLYPHS: Record<
  ExpeditionTheme,
  {
    base: string;
    summit: string;
    decision: string;
    implementation: string;
    outOfScope: string;
  }
> = {
  mountain: {
    base: "⌂",
    summit: "▲",
    decision: "▴",
    implementation: "▲",
    outOfScope: "⊘",
  },
  topo: {
    base: "⌂",
    summit: "◉",
    decision: "▴",
    implementation: "▲",
    outOfScope: "⊘",
  },
  stars: {
    base: "◈",
    summit: "◉",
    decision: "◍",
    implementation: "◍",
    outOfScope: "⊘",
  },
};

export const THEME_ACCENT: Record<ExpeditionTheme, string> = {
  mountain: "#4a9fe0",
  topo: "#58a06a",
  stars: "#5bc0e8",
};

export function resolveTheme(config: Record<string, unknown>): ExpeditionTheme {
  const value = config.expeditionTheme;
  if (
    typeof value === "string" &&
    EXPEDITION_THEMES.includes(value as ExpeditionTheme)
  ) {
    return value as ExpeditionTheme;
  }
  return "mountain";
}
