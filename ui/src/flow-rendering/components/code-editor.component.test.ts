import { describe, expect, it } from "vitest";
import { mount, type } from "../test-utils.ts";
import { CodeEditor } from "./code-editor.ts";

// Behavior tests for the editable code editor: the highlighted overlay, the
// clean textarea value binding, and the hive-code-change contract.

async function mountEditor(
  overrides: Partial<CodeEditor> = {}
): Promise<CodeEditor> {
  const el = await mount(Object.assign(new CodeEditor(), overrides));
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  return el;
}

function textarea(el: CodeEditor): HTMLTextAreaElement {
  const found = el.shadowRoot?.querySelector("textarea");
  expect(found).toBeDefined();
  return found as HTMLTextAreaElement;
}

function overlay(el: CodeEditor): HTMLPreElement {
  const found = el.shadowRoot?.querySelector(".code");
  expect(found).toBeDefined();
  return found as HTMLPreElement;
}

describe("CodeEditor", () => {
  it("renders a highlighted overlay over a clean textarea", async () => {
    const el = await mountEditor({
      value: 'const n = 1; // note\nconst s = "hi";',
    });
    const code = overlay(el);
    // Tokenized: keywords, numbers, comments, strings become spans.
    expect(code.querySelector(".tok-keyword")?.textContent).toBe("const");
    expect(code.querySelector(".tok-number")?.textContent).toBe("1");
    expect(code.querySelector(".tok-comment")?.textContent).toBe("// note");
    expect(code.querySelector(".tok-string")?.textContent).toBe('"hi"');
    // The textarea carries the raw value with no template whitespace.
    expect(textarea(el).value).toBe('const n = 1; // note\nconst s = "hi";');
  });

  it("emits hive-code-change with the edited value on input", async () => {
    const el = await mountEditor({ value: "" });
    const emitted = new Promise<CustomEvent>((resolve) =>
      el.addEventListener("hive-code-change", resolve as EventListener, {
        once: true,
      })
    );
    type(textarea(el), "export const flow = {};");
    expect((await emitted).detail).toEqual({
      value: "export const flow = {};",
    });
  });

  it("threads the disabled flag to the textarea", async () => {
    const el = await mountEditor({ value: "const a = 1;", disabled: true });
    expect(textarea(el).disabled).toBe(true);
  });

  it("syncs the overlay scroll with the textarea", async () => {
    const el = await mountEditor({ value: "line\n".repeat(50) });
    const textareaEl = textarea(el);
    textareaEl.scrollTop = 40;
    textareaEl.dispatchEvent(new Event("scroll", { bubbles: true }));
    await el.updateComplete;
    expect(overlay(el).scrollTop).toBe(40);
  });

  it("does not bind the value as element content", async () => {
    const el = await mountEditor({ value: "const a = 1;" });
    expect(overlay(el).innerHTML).not.toContain("const a = 1;");
    expect(overlay(el).innerHTML).toContain("<span");
  });
});
