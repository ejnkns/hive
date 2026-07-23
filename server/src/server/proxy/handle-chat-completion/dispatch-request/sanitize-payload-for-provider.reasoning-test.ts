/**
 * Test: opencode-zen models — reasoning_content vs reasoning field support.
 * Uses actual model names from the /models endpoint.
 *
 * Run:  npx tsx server/src/server/proxy/handle-chat-completion/dispatch-request/sanitize-payload-for-provider.reasoning-test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

function loadEnv(): Record<string, string> {
  const envPath = join(process.cwd(), ".env");
  const raw = readFileSync(envPath, "utf-8");
  const vars: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    vars[trimmed.slice(0, eq)] = trimmed
      .slice(eq + 1)
      .replace(/^["']|["']$/g, "");
  }
  return vars;
}

async function call(
  apiKey: string,
  model: string,
  messages: Record<string, unknown>[]
): Promise<{
  status: number;
  message: Record<string, unknown> | null;
  error?: string;
}> {
  const body: Record<string, unknown> = { model, messages, stream: true };

  const res = await fetch("https://opencode.ai/zen/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    return {
      status: res.status,
      message: null,
      error: errorBody.slice(0, 300),
    };
  }

  if (!res.body) return { status: res.status, message: null, error: "No body" };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const msg: Record<string, unknown> = { role: "assistant", content: "" };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") continue;

      try {
        const parsed = JSON.parse(data);
        const choices = parsed.choices as
          | Array<Record<string, unknown>>
          | undefined;
        if (!choices?.[0]) continue;
        const delta = choices[0].delta as Record<string, unknown> | undefined;
        if (!delta) continue;

        if (delta.content && typeof delta.content === "string") {
          (msg.content as string) += delta.content;
        }
        for (const field of ["reasoning", "reasoning_content"]) {
          if (delta[field] && typeof delta[field] === "string") {
            msg[field] = ((msg[field] as string) ?? "") + delta[field];
          }
        }
      } catch {
        // skip
      }
    }
  }

  return { status: res.status, message: msg };
}

function inspect(r: {
  status: number;
  message: Record<string, unknown> | null;
}): string {
  if (!r.message) return `status=${r.status}, no msg`;
  const p: string[] = [];
  p.push(`status=${r.status}`);
  if (r.message.reasoning_content)
    p.push(
      `reasoning_content=${(r.message.reasoning_content as string).length}c`
    );
  if (r.message.reasoning)
    p.push(`reasoning=${(r.message.reasoning as string).length}c`);
  if (
    typeof r.message.content === "string" &&
    (r.message.content as string).length > 0
  )
    p.push(`content=${(r.message.content as string).length}c`);
  return p.join(" | ");
}

async function main() {
  const env = loadEnv();
  const key = env.OPENCODE_ZEN_API_KEY;

  // Free models (likely to work without credits)
  const freeModels = [
    "deepseek-v4-flash-free",
    "mimo-v2.5-free",
    "hy3-free",
    "nemotron-3-ultra-free",
    "north-mini-code-free",
  ];

  // Thinking models (may need credits, try anyway)
  const thinkingModels = [
    "deepseek-v4-flash",
    "deepseek-v4-pro",
    "kimi-k2.5",
    "qwen3.6-plus",
  ];

  console.log("=".repeat(70));
  console.log("OPENCODE-ZEN: free model reasoning field tests");
  console.log("=".repeat(70));

  for (const model of freeModels) {
    const r = await call(key, model, [
      { role: "user", content: "Say hi in one sentence." },
    ]);

    if (r.status >= 400) {
      console.log(
        `  ${model.padEnd(32)}  ${r.status} ${(r.error ?? "").slice(0, 80)}`
      );
      continue;
    }

    const produces = (r.message?.reasoning_content as string)
      ? "reasoning_content"
      : (r.message?.reasoning as string)
        ? "reasoning"
        : "none";
    console.log(
      `  ${model.padEnd(32)}  produces=${produces.padEnd(18)}  ${inspect(r)}`
    );

    // If it produces reasoning_content, test if it accepts both fields
    if (r.message?.reasoning_content || r.message?.reasoning) {
      const rcTest = await call(key, model, [
        { role: "user", content: "Hi" },
        {
          role: "assistant",
          content: "hello",
          reasoning_content: "test reasoning",
        },
        { role: "user", content: "Bye" },
      ]);
      const rTest = await call(key, model, [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "hello", reasoning: "test reasoning" },
        { role: "user", content: "Bye" },
      ]);
      console.log(
        `    accepts reasoning_content? ${rcTest.status === 200 ? "YES" : `NO (${rcTest.status})`}`
      );
      console.log(
        `    accepts reasoning?        ${rTest.status === 200 ? "YES" : `NO (${rTest.status})`}`
      );
    } else {
      // Doesn't produce reasoning; does it reject it?
      const rRC = await call(key, model, [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "hello", reasoning_content: "test" },
        { role: "user", content: "Bye" },
      ]);
      const rR = await call(key, model, [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "hello", reasoning: "test" },
        { role: "user", content: "Bye" },
      ]);
      console.log(
        `    rejects reasoning_content? ${rRC.status !== 200 ? `YES (${rRC.status})` : "NO"}`
      );
      console.log(
        `    rejects reasoning?        ${rR.status !== 200 ? `YES (${rR.status})` : "NO"}`
      );
    }
  }

  console.log();
  console.log("=".repeat(70));
  console.log("OPENCODE-ZEN: thinking model reasoning field tests");
  console.log("=".repeat(70));

  for (const model of thinkingModels) {
    const r = await call(key, model, [
      { role: "user", content: "Say hi in one sentence." },
    ]);

    if (r.status >= 400) {
      console.log(
        `  ${model.padEnd(32)}  ${r.status} ${(r.error ?? "").slice(0, 80)}`
      );
      continue;
    }

    const produces = (r.message?.reasoning_content as string)
      ? "reasoning_content"
      : (r.message?.reasoning as string)
        ? "reasoning"
        : "none";
    console.log(
      `  ${model.padEnd(32)}  produces=${produces.padEnd(18)}  ${inspect(r)}`
    );

    if (r.message?.reasoning_content || r.message?.reasoning) {
      // Strip reasoning, send back — does model still work?
      const stripped = { role: "assistant", content: r.message.content };
      const rStrip = await call(key, model, [
        { role: "user", content: "Hi" },
        stripped,
        { role: "user", content: "Bye" },
      ]);
      console.log(
        `    works without reasoning? ${rStrip.status === 200 ? "YES" : `NO (${rStrip.status})`}`
      );
    }
  }
}

main().catch(console.error);
