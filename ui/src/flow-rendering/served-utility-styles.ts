/** @public — the served-component utility-class stylesheet: the styling
 * vocabulary flow UIs are authored against. Hive-authored, token-backed, and
 * Tailwind-compatible in naming so an AI author's Tailwind prior transfers:
 * `flex`, `gap-2`, `p-3`, `rounded-lg`, `text-muted`, `wf-paper`…
 *
 * Delivery: the host injects this as the `utilities` member of
 * `FlowComponentDeps` (a global stylesheet cannot reach shadow DOM), and a
 * served component composes it first in `static styles`, keeping only its
 * small component-specific css after it. App-side default components
 * (`workflow-instance-card`, `action-bar`, `workflow-board-content`) import
 * the same result directly so every flow renders with one vocabulary.
 *
 * Invariants (pinned by served-utility-styles.test.ts and the styling page in
 * `skills/flow-authoring/styling.md`):
 * - token-backed: every color reads a theme token (`--text`, `--muted`,
 *   `--border`, `--surface`, `--wf-*`, `--flow-accent`…), so light/dark and
 *   per-flow themes keep working with zero per-flow theming code;
 * - engine-generic: no domain vocabulary — the only wayfinder words are the
 *   sanctioned `wf-*` theme-token class names;
 * - additive and class-only: no element or universal selectors (no preflight
 *   reaches shadow DOM — a component that composes nothing here renders
 *   exactly as before);
 * - hand-maintained, no build step. If the vocabulary ever outgrows hand
 *   maintenance, the Tier-2 path is a Tailwind v4 content-scan over served
 *   module sources emitting this SAME injected CSSResult — class names and
 *   components unchanged.
 *
 * Known Tailwind divergences (documented in styling.md): `border` is the full
 * `1px solid var(--border)` (no preflight sets border-style in shadow DOM, so
 * Tailwind's width-only `border` would render nothing); spacing/radius/text
 * sizes map to hive's own scales (`--space-*`, `--radius-*`, `--text-*`),
 * not Tailwind's values. */

import { css } from "lit";

export const servedUtilityStyles = css`
  /* ---- layout ------------------------------------------------------- */
  .block {
    display: block;
  }
  .flex {
    display: flex;
  }
  .inline-flex {
    display: inline-flex;
  }
  .grid {
    display: grid;
  }
  .hidden {
    display: none;
  }
  .flex-col {
    flex-direction: column;
  }
  .flex-row {
    flex-direction: row;
  }
  .flex-wrap {
    flex-wrap: wrap;
  }
  .flex-1 {
    flex: 1 1 0%;
  }
  .flex-none {
    flex: none;
  }
  .items-center {
    align-items: center;
  }
  .items-start {
    align-items: flex-start;
  }
  .items-end {
    align-items: flex-end;
  }
  .items-baseline {
    align-items: baseline;
  }
  .items-stretch {
    align-items: stretch;
  }
  .justify-center {
    justify-content: center;
  }
  .justify-between {
    justify-content: space-between;
  }
  .justify-start {
    justify-content: flex-start;
  }
  .justify-end {
    justify-content: flex-end;
  }

  /* ---- gap (4px base scale) ----------------------------------------- */
  .gap-1 {
    gap: var(--space-1);
  }
  .gap-2 {
    gap: var(--space-2);
  }
  .gap-3 {
    gap: var(--space-3);
  }
  .gap-4 {
    gap: var(--space-4);
  }
  .gap-5 {
    gap: var(--space-5);
  }
  .gap-6 {
    gap: var(--space-6);
  }

  /* ---- padding (4px base scale) ------------------------------------- */
  .p-1 {
    padding: var(--space-1);
  }
  .p-2 {
    padding: var(--space-2);
  }
  .p-3 {
    padding: var(--space-3);
  }
  .p-4 {
    padding: var(--space-4);
  }
  .p-5 {
    padding: var(--space-5);
  }
  .p-6 {
    padding: var(--space-6);
  }
  .px-1 {
    padding-left: var(--space-1);
    padding-right: var(--space-1);
  }
  .px-2 {
    padding-left: var(--space-2);
    padding-right: var(--space-2);
  }
  .px-3 {
    padding-left: var(--space-3);
    padding-right: var(--space-3);
  }
  .px-4 {
    padding-left: var(--space-4);
    padding-right: var(--space-4);
  }
  .py-1 {
    padding-top: var(--space-1);
    padding-bottom: var(--space-1);
  }
  .py-2 {
    padding-top: var(--space-2);
    padding-bottom: var(--space-2);
  }
  .py-3 {
    padding-top: var(--space-3);
    padding-bottom: var(--space-3);
  }
  .py-4 {
    padding-top: var(--space-4);
    padding-bottom: var(--space-4);
  }

  /* ---- sizing / overflow --------------------------------------------- */
  .w-full {
    width: 100%;
  }
  .h-full {
    height: 100%;
  }
  .min-h-0 {
    min-height: 0;
  }
  .min-w-0 {
    min-width: 0;
  }
  .overflow-hidden {
    overflow: hidden;
  }
  .overflow-y-auto {
    overflow-y: auto;
  }
  .overflow-x-auto {
    overflow-x: auto;
  }
  .truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ---- shape ---------------------------------------------------------- */
  .rounded-sm {
    border-radius: var(--radius-sm);
  }
  .rounded-md {
    border-radius: var(--radius-md);
  }
  .rounded-lg {
    border-radius: var(--radius-lg);
  }
  .rounded-full {
    border-radius: 9999px;
  }

  /* ---- borders. Divergence from Tailwind: "border" is the full shorthand
     (no preflight sets border-style inside shadow DOM, so a width-only
     border renders nothing). "border-dashed" restyles it. */
  .border {
    border: 1px solid var(--border);
  }
  .border-dashed {
    border-style: dashed;
  }
  .wf-paper-edge {
    border-color: var(--wf-paper-edge);
  }

  /* ---- color (all bound to theme tokens — no literals) ---------------- */
  .text-muted {
    color: var(--muted);
  }
  .text-accent {
    color: var(--flow-accent, var(--accent));
  }
  .text-success {
    color: var(--success);
  }
  .text-error {
    color: var(--error);
  }
  .text-warning {
    color: var(--warning);
  }
  .text-on-accent {
    color: var(--on-accent);
  }
  .wf-ink {
    color: var(--wf-ink);
  }
  .wf-body {
    color: var(--wf-body);
  }
  .bg-bg {
    background: var(--bg);
  }
  .bg-card {
    background: var(--card);
  }
  .bg-surface {
    background: var(--surface);
  }
  .bg-accent {
    background: var(--flow-accent, var(--accent));
  }
  .bg-transparent {
    background: transparent;
  }
  .wf-paper {
    background: var(--wf-paper);
  }

  /* ---- typography (hive's mono scale) --------------------------------- */
  .text-xs {
    font-size: var(--text-xs);
  }
  .text-sm {
    font-size: var(--text-sm);
  }
  .text-base {
    font-size: var(--text-base);
  }
  .text-md {
    font-size: var(--text-md);
  }
  .text-lg {
    font-size: var(--text-lg);
  }
  .font-bold {
    font-weight: 700;
  }
  .uppercase {
    text-transform: uppercase;
  }
  .tracking-wide {
    letter-spacing: 0.1em;
  }

  /* ---- interaction ----------------------------------------------------- */
  .cursor-pointer {
    cursor: pointer;
  }

  /* ---- position -------------------------------------------------------- */
  .relative {
    position: relative;
  }
  .absolute {
    position: absolute;
  }
  .inset-0 {
    inset: 0;
  }
`;
