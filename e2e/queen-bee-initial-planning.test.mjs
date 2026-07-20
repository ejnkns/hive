import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { startHiveTestApp } from "./support/hive-test-app.mjs";
import { startMockProvider } from "./support/mock-provider.mjs";

test("a user can plan, implement, review, and accept a Card into hive-main", {
  timeout: 60_000,
}, async () => {
  const provider = await startMockProvider();
  const hive = await startHiveTestApp(provider.host);
  try {
    const { page } = hive;
    await page.goto(hive.baseUrl);
    await page.getByRole("button", { name: "New Project" }).click();
    await page.getByLabel("Repository path").fill(hive.projectPath);
    await page.getByLabel("Project name (optional)").fill("E2E Project");
    await page.getByRole("button", { name: "Create Project" }).click();
    await page.getByRole("link", { name: "Open" }).click();

    await visible(page.getByText("main is up to date"));
    await page
      .getByPlaceholder("Describe your project...")
      .fill("Display a deterministic greeting");
    await page.getByRole("button", { name: "Send" }).click();
    await visible(
      page.getByText(
        "Should the initial feature display a deterministic greeting?"
      )
    );

    await page
      .getByPlaceholder("Your answer...")
      .fill("Yes, use the exact greeting Hello from Hive");
    await page.getByRole("button", { name: "Send" }).click();
    await visible(page.getByRole("button", { name: "Generate project plan" }));
    await visible(page.getByText("Live requirements draft"));

    await page.reload();
    await visible(page.getByRole("button", { name: "Generate project plan" }));
    await page.getByRole("button", { name: "Generate project plan" }).click();
    await visible(page.getByRole("heading", { name: "Review project plan" }));
    await visible(page.getByRole("heading", { name: "Proposed requirements" }));
    await visible(
      page.getByText("Render deterministic greeting", { exact: true })
    );

    await page.reload();
    await visible(page.getByRole("button", { name: "Accept plan" }));
    await page.getByRole("button", { name: "Accept plan" }).click();
    await visible(
      page.getByText("Render deterministic greeting", { exact: true })
    );
    await visible(page.getByRole("button", { name: "Run worker" }));
    await visible(page.getByText("1 commit ready"));

    await page.reload();
    await visible(
      page.getByText("Render deterministic greeting", { exact: true })
    );
    await visible(page.getByRole("button", { name: "Run worker" }));
    await visible(page.getByText("1 commit ready"));

    await page.getByRole("button", { name: "Run worker" }).click();
    await visible(page.getByText("approved", { exact: true }));
    await page
      .getByText("Render deterministic greeting", { exact: true })
      .click();
    await visible(page.getByRole("button", { name: "Accept into hive-main" }));
    await page.getByRole("button", { name: "Accept into hive-main" }).click();
    await visible(page.getByText("Done", { exact: true }));
    await page.locator(".btn-close").click();
    await page.locator(".overlay").waitFor({ state: "detached" });
    await visible(page.getByText("3 commits ready"));
    await visible(page.getByRole("button", { name: "Integrate into main" }));

    await page.reload();
    await visible(
      page.getByText("Render deterministic greeting", { exact: true })
    );
    await visible(page.getByText("Done", { exact: true }));
    await visible(page.getByText("3 commits ready"));

    assert.equal(
      execFileSync("git", ["show", "hive-main:src/app.ts"], {
        cwd: hive.projectPath,
        encoding: "utf-8",
      }),
      'export const greeting = "Hello from Hive";\n'
    );
    assert.deepEqual(provider.failures, []);
  } catch (error) {
    const pageText = await hive.page
      .locator("body")
      .innerText()
      .catch(() => "");
    throw new Error(
      `${error instanceof Error ? error.stack : String(error)}\n\nPage text:\n${pageText}\n\nHive output:\n${hive.output()}\n\nMock failures:\n${provider.failures.join("\n")}\n\nMock requests:\n${JSON.stringify(summarizeRequests(provider.requests), null, 2)}`
    );
  } finally {
    await hive.close();
    await provider.close();
  }
});

async function visible(locator) {
  await locator.waitFor({ state: "visible", timeout: 10_000 });
}

function summarizeRequests(requests) {
  return requests.map((request) => ({
    messages: request.messages?.map((message) => ({
      role: message.role,
      content: String(message.content ?? "").slice(0, 120),
      reasoning_content: message.reasoning_content,
      tool_call_id: message.tool_call_id,
      tool_calls: message.tool_calls?.map(
        (toolCall) => toolCall.function?.name
      ),
    })),
    tools: request.tools?.map((tool) => tool.function?.name),
  }));
}
