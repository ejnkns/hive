import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigField } from "workflow-engine/workflow-types";
import {
  click,
  mount,
  queryAllDeep,
  settle,
  shadowRootOf,
  type,
} from "../test-utils";
import { FlowCreateForm } from "./flow-create-form";

// Behavior tests for the built-in flow-creation page component: fetches the
// definition's configSchema, renders the name field plus one
// config-field-control per schema field, gates on required/name checks, and
// submits createFlow with the collected config. The REST client is stubbed at
// the fetch seam (the component calls the real flow-api functions).

const DEFINITION_ID = "my-flow";
const SCHEMA: ConfigField[] = [
  { key: "title", label: "Title", type: "string", required: true },
  { key: "note", label: "Note", type: "textarea" },
];

type CapturedRequest = {
  url: string;
  method: string;
  body?: unknown;
};

let requests: CapturedRequest[] = [];

function stubFetch() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    requests.push({
      url,
      method: init?.method ?? "GET",
      body:
        init?.body !== undefined ? JSON.parse(String(init.body)) : undefined,
    });
    if (url === `/api/flows/definitions/${DEFINITION_ID}`) {
      return {
        ok: true,
        json: async () => ({
          id: DEFINITION_ID,
          name: "My Flow",
          builtIn: false,
          configSchema: SCHEMA,
          source: "export const flow = {};",
        }),
      };
    }
    if (url === "/api/flows" && init?.method === "POST") {
      return { ok: true, json: async () => ({ ok: true, flowId: "f1" }) };
    }
    return { ok: false, json: async () => ({ error: "Not found" }) };
  });
  vi.stubGlobal("fetch", fetchMock);
}

afterEach(() => {
  vi.unstubAllGlobals();
  requests = [];
});

async function mountForm(
  overrides: Partial<FlowCreateForm> = {}
): Promise<FlowCreateForm> {
  const el = await mount(
    Object.assign(new FlowCreateForm(), {
      definitionId: DEFINITION_ID,
      ...overrides,
    })
  );
  await el.updateComplete;
  await settle(shadowRootOf(el));
  // The definition fetch resolves on a microtask after mount.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await settle(shadowRootOf(el));
  return el;
}

function nameInput(el: FlowCreateForm): HTMLInputElement {
  const found = el.shadowRoot?.querySelector(
    'input[name="name"]'
  ) as HTMLInputElement;
  expect(found).toBeDefined();
  return found;
}

function submitButton(el: FlowCreateForm): HTMLButtonElement {
  const found = queryAllDeep(el, "button").find(
    (b) => b.textContent?.trim() === "Create instance"
  ) as HTMLButtonElement | undefined;
  expect(found).toBeDefined();
  return found as HTMLButtonElement;
}

describe("FlowCreateForm", () => {
  it("fetches the definition and renders the name field plus one control per schema field", async () => {
    stubFetch();
    const el = await mountForm();
    expect(nameInput(el)).toBeDefined();
    // The schema controls render in light DOM under the shadow root.
    const controls = el.shadowRoot?.querySelectorAll("config-field-control");
    expect(controls?.length).toBe(SCHEMA.length);
    expect(el.shadowRoot?.querySelector('input[name="title"]')).toBeDefined();
    expect(el.shadowRoot?.querySelector('textarea[name="note"]')).toBeDefined();
    expect(requests[0]?.url).toBe(`/api/flows/definitions/${DEFINITION_ID}`);
  });

  it("submits createFlow with { definitionId, config } carrying name and collected fields", async () => {
    stubFetch();
    const el = await mountForm();
    type(nameInput(el), "My instance");
    type(
      el.shadowRoot?.querySelector('input[name="title"]') as HTMLInputElement,
      "A title"
    );
    await el.updateComplete;

    const created = new Promise<CustomEvent>((resolve) =>
      el.addEventListener("hive-flow-created", resolve as EventListener, {
        once: true,
      })
    );
    submitButton(el).dispatchEvent(click());
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));

    const post = requests.find(
      (r) => r.url === "/api/flows" && r.method === "POST"
    );
    expect(post?.body).toEqual({
      definitionId: DEFINITION_ID,
      config: { name: "My instance", title: "A title" },
    });
    expect((await created).detail).toEqual({
      definitionId: DEFINITION_ID,
      slug: "my-instance",
    });
  });

  it("gates submission on a non-empty name and required fields", async () => {
    stubFetch();
    const el = await mountForm();
    expect(submitButton(el).disabled).toBe(true);

    type(nameInput(el), "My instance");
    await el.updateComplete;
    expect(submitButton(el).disabled).toBe(true);

    type(
      el.shadowRoot?.querySelector('input[name="title"]') as HTMLInputElement,
      "A title"
    );
    await el.updateComplete;
    expect(submitButton(el).disabled).toBe(false);
  });

  it("blocks a reserved 'new' slug with a name warning", async () => {
    stubFetch();
    const el = await mountForm();
    type(nameInput(el), "New");
    type(
      el.shadowRoot?.querySelector('input[name="title"]') as HTMLInputElement,
      "A title"
    );
    await el.updateComplete;
    expect(
      el.shadowRoot?.textContent?.includes('"new" is a reserved flow name')
    ).toBe(true);

    submitButton(el).dispatchEvent(click());
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      requests.some((r) => r.url === "/api/flows" && r.method === "POST")
    ).toBe(false);
  });

  it("surfaces a server error on failed creation", async () => {
    stubFetch();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({
        url,
        method: init?.method ?? "GET",
        body:
          init?.body !== undefined ? JSON.parse(String(init.body)) : undefined,
      });
      if (url === `/api/flows/definitions/${DEFINITION_ID}`) {
        return {
          ok: true,
          json: async () => ({
            id: DEFINITION_ID,
            name: "My Flow",
            builtIn: false,
            configSchema: SCHEMA,
            source: "export const flow = {};",
          }),
        };
      }
      return {
        ok: false,
        json: async () => ({ error: "Name already in use" }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const el = await mountForm();
    type(nameInput(el), "My instance");
    type(
      el.shadowRoot?.querySelector('input[name="title"]') as HTMLInputElement,
      "A title"
    );
    await el.updateComplete;
    submitButton(el).dispatchEvent(click());
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(el.shadowRoot?.textContent?.includes("Name already in use")).toBe(
      true
    );
  });

  it("emits hive-flow-cancel on cancel", async () => {
    stubFetch();
    const el = await mountForm();
    const cancelled = new Promise<CustomEvent>((resolve) =>
      el.addEventListener("hive-flow-cancel", resolve as EventListener, {
        once: true,
      })
    );
    const cancel = queryAllDeep(el, "button").find(
      (b) => b.textContent?.trim() === "Cancel"
    );
    expect(cancel).toBeDefined();
    cancel?.dispatchEvent(click());
    await cancelled;
  });
});
