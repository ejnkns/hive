/** @private — only imported by expedition-chrome.ts. Emulates the
 * prefers-reduced-motion media query at the JS seam the wayfinder map
 * controller reads (prefersReducedMotion, map-controller.ts: matchMedia once
 * per mount, snapping the camera easing and freezing the twinkle layer).
 *
 * Why a seam shim despite Chromatic's native media emulation: the emulation
 * option configures Chromatic's CLOUD capture browser, not local `storybook
 * dev` sessions, and it could not reach the canvas anyway — the twinkle
 * layer repaints on requestAnimationFrame, not via CSS, and the controller
 * reads the media query once per mount. The controller's read-once seam is
 * the contract the reduced-motion stories verify; shimming it gives
 * byte-identical canvas output across builds (time frozen at 0, camera
 * easing snapped) while still exercising the REAL reduced-motion code path,
 * not bypassing it. The CSS-side `@media (prefers-reduced-motion)` rules
 * are a browser-only concern Chromatic covers by pausing CSS animations
 * during capture. */

let originalMatchMedia: typeof window.matchMedia | undefined;

/** Installs the emulation (idempotent). Restored by
 * `uninstallReducedMotionEmulation`. */
export function installReducedMotionEmulation(): void {
  if (originalMatchMedia !== undefined) return;
  originalMatchMedia = window.matchMedia?.bind(window);
  window.matchMedia = ((query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)",
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {
      return () => {};
    },
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/** Restores the browser's real matchMedia. The controller reads the query
 * once per mount, so a restore after the story's first frame never un-freezes
 * an already-mounted surface. */
export function uninstallReducedMotionEmulation(): void {
  if (originalMatchMedia === undefined) return;
  window.matchMedia = originalMatchMedia;
  originalMatchMedia = undefined;
}
