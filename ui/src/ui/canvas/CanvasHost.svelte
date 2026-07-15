<script lang="ts">
import { onMount } from "svelte";
import { SYSTEM_PROMPT_INITIAL, SYSTEM_PROMPT_PATCH } from "./canvas-prompts";
import { setupCanvasRuntime } from "./canvas-runtime";

let iframeEl: HTMLIFrameElement;
let promptInput = $state("");
let isStreaming = $state(false);
let chatHistory: Array<{ role: string; content: string }> = $state([]);
let currentHtml: string | null = $state(null);

const SESSION_KEY = "canvas-session-id";
function getSessionId(): string {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}
const sessionId = getSessionId();

const IFRAME_RUNTIME = `\x3Cscript>(${setupCanvasRuntime.toString()})(window);\x3C/script>`;

async function saveState(html: string | null) {
  await fetch(`/api/canvas-state/${sessionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ html, chatHistory }),
  });
}

async function handleDOMSummaryResponse(
  summary: Array<Record<string, string | null>>
) {
  const url = "/v1/chat/completions";

  const systemPrompt = `${SYSTEM_PROMPT_PATCH}\n\nCurrent interactive elements on page: ${JSON.stringify(summary)}`;

  const messages = [{ role: "system", content: systemPrompt }, ...chatHistory];

  await performStreamingRequest(url, messages, false);
}

$effect(() => {
  const handleMessage = (event: MessageEvent) => {
    if (event.data?.type === "DOM_SUMMARY_RESPONSE") {
      handleDOMSummaryResponse(event.data.payload);
    }
    if (event.data?.type === "HTML_SERIALIZED") {
      currentHtml = event.data.payload;
      saveState(event.data.payload);
    }
  };
  window.addEventListener("message", handleMessage);
  return () => window.removeEventListener("message", handleMessage);
});

onMount(async () => {
  const res = await fetch(`/api/canvas-state/${sessionId}`);
  if (res.ok) {
    const state = await res.json();
    if (state.html) {
      currentHtml = state.html;
    }
    if (state.chatHistory?.length) {
      chatHistory = state.chatHistory;
    }
  }
});

$effect(() => {
  if (currentHtml && iframeEl) {
    iframeEl.srcdoc = IFRAME_RUNTIME + currentHtml;
  }
});

async function submitPrompt() {
  if (!promptInput.trim() || isStreaming) return;

  const userMessage = promptInput.trim();
  promptInput = "";
  chatHistory.push({ role: "user", content: userMessage });

  saveState(currentHtml);

  const isInitial = !currentHtml;

  if (isInitial) {
    const url = "/v1/chat/completions";
    const messages = [
      { role: "system", content: SYSTEM_PROMPT_INITIAL },
      ...chatHistory,
    ];
    await performStreamingRequest(url, messages, true);
  } else {
    if (iframeEl?.contentWindow) {
      iframeEl.contentWindow.postMessage({ type: "REQUEST_DOM_SUMMARY" }, "*");
    }
  }
}

function extractContent(
  response: string,
  tag: "canvas-build" | "canvas-patch"
): string | null {
  const startTag = `<${tag}>`;
  const endTag = `</${tag}>`;
  const startIndex = response.indexOf(startTag);
  if (startIndex === -1) return null;
  const contentStart = startIndex + startTag.length;
  const endIndex = response.indexOf(endTag, contentStart);
  return endIndex === -1
    ? response.slice(contentStart)
    : response.slice(contentStart, endIndex);
}

async function performStreamingRequest(
  url: string,
  messages: Array<{ role: string; content: string }>,
  isInitial: boolean
) {
  console.log("[HOST] performStreamingRequest", {
    url,
    isInitial,
    msgCount: messages.length,
  });
  isStreaming = true;
  let fullResponse = "";
  let lineBuffer = "";

  try {
    console.log("[HOST] Sending fetch to", url);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "default",
        messages,
        stream: true,
      }),
    });

    console.log("[HOST] fetch response", {
      status: res.status,
      ok: res.ok,
      hasBody: !!res.body,
    });

    if (!res.ok || !res.body) throw new Error("Failed to connect to backend");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    if (isInitial) {
      console.log("[HOST] Sending BUILD_START to iframe");
      iframeEl.contentWindow?.postMessage({ type: "BUILD_START" }, "*");
    }

    while (true) {
      const { done, value } = await reader.read();
      console.log("[HOST] read()", { done, bytes: value?.byteLength ?? 0 });
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      lineBuffer += chunk;
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";

      console.log("[HOST] chunk decoded into", lines.length, "lines");

      for (const [lineIdx, line] of lines.entries()) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ") || trimmed === "data: [DONE]")
          continue;
        try {
          const jsonStr = trimmed.slice(6);
          const parsed = JSON.parse(jsonStr);
          const delta = parsed.choices?.[0]?.delta?.content || "";
          if (delta) {
            fullResponse += delta;
            console.log("[HOST] delta accumulated", {
              lineIdx,
              deltaLen: delta.length,
              deltaPreview: delta.substring(0, 40),
              fullLen: fullResponse.length,
            });
          }
        } catch (e) {
          console.log("[HOST] parse error on line", {
            lineIdx,
            linePreview: line.substring(0, 80),
            error: (e as Error).message,
          });
        }
      }
    }

    console.log("[HOST] Stream complete. fullResponse:", fullResponse);

    if (isInitial) {
      const htmlContent = extractContent(fullResponse, "canvas-build");
      console.log(
        "[HOST] Extracted htmlContent:",
        htmlContent ? htmlContent.length + " chars" : "null"
      );
      if (htmlContent && iframeEl) {
        console.log(
          "[HOST] Setting iframe.srcdoc with IFRAME_RUNTIME + htmlContent"
        );
        currentHtml = htmlContent;
        iframeEl.srcdoc = IFRAME_RUNTIME + htmlContent;
        saveState(htmlContent);
      } else {
        console.log("[HOST] No htmlContent extracted or iframe missing");
      }
    } else {
      const jsContent = extractContent(fullResponse, "canvas-patch");
      console.log(
        "[HOST] Extracted jsContent:",
        jsContent ? jsContent.length + " chars" : "null"
      );
      if (jsContent && iframeEl?.contentWindow) {
        console.log("[HOST] Sending APPLY_PATCH to iframe");
        iframeEl.contentWindow.postMessage(
          { type: "APPLY_PATCH", payload: jsContent },
          "*"
        );
        iframeEl.contentWindow.postMessage({ type: "SERIALIZE_HTML" }, "*");
      } else {
        console.log("[HOST] No jsContent extracted or iframe missing");
      }
    }

    chatHistory.push({ role: "assistant", content: fullResponse });
  } catch (err) {
    console.error("[HOST] Error:", err);
  } finally {
    isStreaming = false;
  }
}
</script>

<div class="canvas-container">
  <iframe
    bind:this={iframeEl}
    sandbox="allow-scripts" 
    srcdoc={IFRAME_RUNTIME}
    class="canvas-iframe"
    title="Ephemeral Canvas"
  ></iframe>

  <div class="floating-panel">
    <div class="chat-history">
      {#each chatHistory as msg}
        {#if msg.role === 'user'}
          <div class="msg user-msg">{msg.content}</div>
        {/if}
      {/each}
    </div>
    
    <div class="input-area">
      <input 
        type="text" 
        bind:value={promptInput}
        onkeydown={(e) => e.key === 'Enter' && submitPrompt()}
        placeholder="Describe the app you want to build or patch..."
        disabled={isStreaming}
      />
      <button onclick={submitPrompt} disabled={isStreaming || !promptInput.trim()}>
        {isStreaming ? '...' : 'Send'}
      </button>
    </div>
  </div>
</div>

<style>
  .canvas-container {
    position: relative;
    width: 100%;
    height: calc(100vh - 164px);
    overflow: hidden;
  }
  
  .canvas-iframe {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    border: none;
    background: #fff;
  }

  .floating-panel {
    position: absolute;
    bottom: 2rem;
    left: 50%;
    transform: translateX(-50%);
    width: 90%;
    max-width: 600px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .chat-history {
    max-height: 150px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .msg {
    font-size: 0.8rem;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    background: rgba(0,0,0,0.05);
  }
  
  .user-msg {
    font-weight: 500;
    color: var(--accent);
  }

  .input-area {
    display: flex;
    gap: 0.5rem;
  }

  input {
    flex: 1;
    padding: 0.5rem;
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 4px;
  }

  button {
    padding: 0.5rem 1rem;
    background: var(--accent);
    color: #000;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: bold;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
