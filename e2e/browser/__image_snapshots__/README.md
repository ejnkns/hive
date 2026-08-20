# e2e screenshot baselines

Committed reference PNGs for the visual-regression assertions on the wayfinder
stability surface (ticket 10). Each file is the settled render of one
`app.assertScreenshot(...)` call in
`e2e/browser/wayfinder-surface-stability.test.mjs`:

| baseline | asserts |
| --- | --- |
| `surface-map-topo.png` | the map view open with the cycled `topo` theme (captured before the churn window) |
| `surface-fog-reordered.png` | the fog tray with the reordered pile — the dragged card on top (tray's own box) |
| `surface-view-persisted.png` | the view state (map open, cycled theme, churned fog) after the network-level interruption |

These files are tracked (unlike `__screenshots__/`, which is gitignored).

## How the comparison works

The app under test runs in a SECOND page of the same Chrome (see
`e2e/app-commands.ts` header), so vitest's `toHaveScreenshot` cannot see it and
`toMatchFileSnapshot` cannot carry binary buffers here (the command channel
serializes Buffers to plain objects, and raw snapshot files are written/read as
utf-8 text — a PNG only round-trips as its text serialization, never as image
bytes). The capture + comparison therefore both happen on the Node side, in the
`appAssertScreenshot` command:

1. The app page is captured (deterministic viewport / element box; Playwright
   freezes CSS animations and hides the caret).
2. The capture waits for the paint to SETTLE: two consecutive captures must be
   within tolerance of each other. This matters because the expedition theme's
   `--wf-*` colors blend over `--dur-slow` (400ms) after a theme cycle, and the
   computed style reaches its final value before the paint does — a capture
   right after a cycle lands mid-blend. (The test additionally waits for the
   theme colors with `settleThemeColors` before each shot.)
3. The settled capture is compared against the baseline **pixel-wise with a
   small tolerance**: max channel delta ≤ 8 AND ≤ 0.05% differing pixels.
   Headless Chromium re-rasterizes the map's SVG contour strokes (1px strokes
   under `preserveAspectRatio="none"` non-uniform scaling) with ±1-channel
   antialiasing jitter between rasterizations — invisible, but it makes
   byte-exact comparison flaky. The tolerance absorbs that jitter with ~8x
   headroom; any real visual regression (theme colors, fog order, layout shift,
   content change) produces deltas far above it.
4. On mismatch the actual render is saved to the gitignored
   `e2e/__screenshots__/app/<name>-actual-<ts>.png` and the failure reports
   both paths plus the pixel stats.

The map shots capture the `workflow-instances` surface element rather than the
whole viewport because the app shell's top-bar breadcrumb shows the run-unique
flow name (date-suffixed), which changes every run and would make a full-page
baseline inherently unstable.

## Recording / updating baselines

Baselines are NEVER written by a normal run. Record or update them explicitly:

```sh
# vitest's snapshot-update mode (note: `-u` takes an optional argument, so the
# file filter must come BEFORE it, otherwise the filter is swallowed):
pnpm exec vitest run --config e2e/vitest.config.ts e2e/browser/wayfinder-surface-stability.test.mjs -u

# or the explicit env flag (no CLI quirk):
E2E_UPDATE_SCREENSHOTS=1 pnpm exec vitest run --config e2e/vitest.config.ts e2e/browser/wayfinder-surface-stability.test.mjs
```

A missing baseline is a hard failure with these instructions — the suite never
silently creates a baseline from a possibly-broken render.

**Review flow:** when a screenshot fails, look at the reported actual vs the
baseline; if the new render is intended (e.g. a deliberate surface change),
re-record with `-u` and commit the updated PNG along with the change. If it is
not intended, fix the surface and re-run.

## Sharding

The e2e suite splits across CI shards; each shard is its own vitest run with
its own server + mock provider + temp data dir (booted per-run in
`e2e/global-setup.ts` on random ports), and flow names are date-suffixed per
run, so shards are fully isolated:

```sh
pnpm exec vitest run --config e2e/vitest.config.ts --shard=1/2
pnpm exec vitest run --config e2e/vitest.config.ts --shard=2/2
```

`fileParallelism: false` keeps files sequential within a shard, which is
compatible with sharding (verified: `--shard=1/2` = 4 files / 4 tests and
`--shard=2/2` = 4 files / 14 tests, both green, together covering all 8 files /
18 tests).
