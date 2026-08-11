import { describe, expect, it } from "vitest";
import { mount, mustQuery, settle, shadowRootOf } from "../test-utils.ts";
import { MarkdownView } from "./markdown-view.ts";

describe("MarkdownView", () => {
  it("renders markdown structure", async () => {
    const el = await mount(
      Object.assign(new MarkdownView(), {
        content: "# Heading\n\n- one\n- two",
      })
    );
    await settle(shadowRootOf(el));
    const root = mustQuery(shadowRootOf(el), ".markdown");
    expect(root.querySelector("h1")?.textContent).toBe("Heading");
    expect(root.querySelectorAll("li").length).toBe(2);
  });

  it("drops raw HTML from the source", async () => {
    const el = await mount(
      Object.assign(new MarkdownView(), {
        content: "safe <script>alert(1)</script> <img src=x onerror=alert(1)>",
      })
    );
    await settle(shadowRootOf(el));
    const root = mustQuery(shadowRootOf(el), ".markdown");
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector("img")).toBeNull();
    expect(root.textContent).toContain("safe");
  });
});
