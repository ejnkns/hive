# Flow UI styling — the utility-class vocabulary

Every flow UI is styled with ONE shared utility-class stylesheet. The host
injects it into every served component factory as the `utilities` member of
`FlowComponentDeps` (beside `LitElement`, `html`, `css`, `nothing`, `svg`).
Compose it FIRST in `static styles`, then add only your small
component-specific css after it — later sheets win, so component css can
override a utility:

```ts
export default function (deps: FlowComponentDeps) {
  const { LitElement, html, css, utilities } = deps;
  class MyCard extends LitElement {
    static styles = [
      utilities,
      css`
        :host { display: block; }
        .title { letter-spacing: 0.06em; } /* component-specific only */
      `,
    ];
    render() {
      return html`<div class="flex items-center justify-between gap-2">
        <span class="text-md font-bold">Title</span>
        <span class="text-xs text-muted">meta</span>
      </div>`;
    }
  }
  return { components: { "my-card": MyCard } };
}
```

The class names are Tailwind-compatible (an AI's Tailwind prior transfers)
but hive-curated: a small, closed set, bound to the app's theme tokens. Do
NOT invent classes outside this list — they silently do nothing. For anything
the list does not cover (off-scale sizes, dashed 2px chips, per-state
variants, hover styles, per-theme textures), write a small component css rule
named after your component's concept.

Rules:

- Compose `utilities` first; keep component css small and concept-named.
- Never style with raw hex/rgb colors — use the classes (or reference the
  tokens directly in component css) so light/dark and per-flow themes work
  with zero per-flow theming code.
- No preflight reaches shadow DOM: there is no default box-sizing, margin
  reset, or font inheritance. Set `:host` display yourself, and prefer
  utilities that do not depend on a reset.
- Divergence from Tailwind: `border` is the FULL shorthand
  (`1px solid var(--border)`) — a width-only border would render nothing
  without preflight. Pair it with `border-dashed` to restyle.
- Elements and universal selectors never appear in the utility sheet, so a
  component that does not compose it renders exactly as before.

## The class list

Layout:

```
block
flex
inline-flex
grid
hidden
flex-col
flex-row
flex-wrap
flex-1
flex-none
items-center
items-start
items-end
items-baseline
items-stretch
justify-center
justify-between
justify-start
justify-end
```

Gap and padding (hive 4px scale, `--space-1`=4px … `--space-6`=32px):

```
gap-1
gap-2
gap-3
gap-4
gap-5
gap-6
p-1
p-2
p-3
p-4
p-5
p-6
px-1
px-2
px-3
px-4
py-1
py-2
py-3
py-4
```

Sizing, overflow, position:

```
w-full
h-full
min-h-0
min-w-0
overflow-hidden
overflow-x-auto
overflow-y-auto
truncate
relative
absolute
inset-0
```

Shape and borders (`--radius-sm`=4px, `--radius-md`=6px, `--radius-lg`=8px):

```
rounded-sm
rounded-md
rounded-lg
rounded-full
border
border-dashed
wf-paper-edge
```

Text and background colors:

```
text-muted
text-accent
text-success
text-error
text-warning
text-on-accent
wf-ink
wf-body
bg-bg
bg-card
bg-surface
bg-accent
bg-transparent
wf-paper
```

Typography (hive mono scale):

```
text-xs
text-sm
text-base
text-md
text-lg
font-bold
uppercase
tracking-wide
```

Interaction:

```
cursor-pointer
```

## The tokens the classes bind to

Colors (all theme-aware — they resolve through the active light/dark theme
and any per-flow theme):

- Base surface/text: `--bg`, `--card`, `--surface`, `--border`, `--text`,
  `--muted`, `--accent`, `--on-accent`, `--success`, `--error`, `--warning`
- Flow theme (set by a flow's declarative theme, fallback to base):
  `--flow-accent`, `--flow-accent-rgb`, `--flow-on-accent`
- Wayfinder expedition theme (registered app-side, inherited into shadow
  DOM): `--wf-paper`, `--wf-paper-edge`, `--wf-ink`, `--wf-body`,
  `--wf-accent`

Type and space: `--text-xs` 11px, `--text-sm` 12px, `--text-base` 13px,
`--text-md` 15px, `--text-lg` 18px; `--space-1`, `--space-2`, `--space-3`,
`--space-4`, `--space-5`, `--space-6`, `--space-7` (4px steps to 48px);
`--radius-sm`, `--radius-md`, `--radius-lg` (4/6/8px); `--font-mono`.
