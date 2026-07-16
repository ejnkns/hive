/**
 * Sets up the canvas runtime inside the iframe.
 * Injected via IFRAME_RUNTIME in CanvasHost.svelte.
 * Exported as a real function so it can be imported, tested, and type-checked.
 */
export function setupCanvasRuntime(win: Window): void {
  win.addEventListener("message", (event: MessageEvent) => {
    const { type, payload } = event.data;
    switch (type) {
      case "BUILD_START": {
        break;
      }
      case "APPLY_PATCH": {
        try {
          const script = win.document.createElement("script");
          script.textContent = payload;
          win.document.body.appendChild(script);
        } catch (err) {
          console.error("[IFRAME] Patch execution failed:", err);
        }
        break;
      }
      case "SERIALIZE_HTML": {
        win.parent.postMessage(
          {
            type: "HTML_SERIALIZED",
            payload: win.document.documentElement.outerHTML,
          },
          "*"
        );
        break;
      }
      case "REQUEST_DOM_SUMMARY": {
        const elements: Array<{
          tag: string;
          id: string | null;
          classes: string | null;
          text: string | null;
        }> = [];
        win.document.querySelectorAll("body *").forEach((el) => {
          const htmlEl = el as HTMLElement;
          const className =
            typeof htmlEl.className === "string"
              ? htmlEl.className
              : ((htmlEl.className as SVGAnimatedString)?.baseVal ?? null);
          const text =
            (htmlEl as { innerText?: string }).innerText ??
            htmlEl.textContent ??
            null;
          if (
            htmlEl.id ||
            className ||
            htmlEl.tagName === "BUTTON" ||
            htmlEl.tagName === "INPUT"
          ) {
            elements.push({
              tag: htmlEl.tagName,
              id: htmlEl.id || null,
              classes: className,
              text: text ? text.substring(0, 30) : null,
            });
          }
        });
        win.parent.postMessage(
          { type: "DOM_SUMMARY_RESPONSE", payload: elements },
          "*"
        );
        break;
      }
    }
  });
}
