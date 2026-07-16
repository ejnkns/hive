<script lang="ts">
import { onMount } from "svelte";
import { SYSTEM_PROMPT_INITIAL, SYSTEM_PROMPT_PATCH } from "./canvas-prompts";
import { setupCanvasRuntime } from "./canvas-runtime";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  responseText?: string;
};

let iframeEl: HTMLIFrameElement | undefined = $state();
let promptInput = $state("");
let isStreaming = $state(false);
let chatHistory: ChatMessage[] = $state([]);
let currentHtml: string | null = $state(null);
let stateLoaded = $state(false);

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
  stateLoaded = true;
});

const DOCTYPE_PREFIX = "<!DOCTYPE html>";

function stripDoctype(html: string): string {
  return html.replace(/^<!DOCTYPE\s+html[^>]*>/i, "").trimStart();
}

function buildSrcdoc(html: string | null): string {
  if (!html) return IFRAME_RUNTIME;
  return DOCTYPE_PREFIX + IFRAME_RUNTIME + stripDoctype(html);
}

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
  tag: "canvas-build" | "canvas-patch" | "canvas-response"
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
  isStreaming = true;
  let fullResponse = "";
  let lineBuffer = "";

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "default",
        messages,
        stream: true,
      }),
    });

    if (!res.ok || !res.body) throw new Error("Failed to connect to backend");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    if (isInitial) {
      iframeEl?.contentWindow?.postMessage({ type: "BUILD_START" }, "*");
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      lineBuffer += chunk;
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ") || trimmed === "data: [DONE]")
          continue;
        try {
          const jsonStr = trimmed.slice(6);
          const parsed = JSON.parse(jsonStr);
          const delta = parsed.choices?.[0]?.delta?.content || "";
          if (delta) {
            fullResponse += delta;
          }
        } catch {
          // skip malformed SSE lines
        }
      }
    }

    const responseText = extractContent(fullResponse, "canvas-response");

    if (isInitial) {
      const htmlContent = extractContent(fullResponse, "canvas-build");
      if (htmlContent) {
        currentHtml = htmlContent;
        saveState(htmlContent);
      }
    } else {
      const htmlContent = extractContent(fullResponse, "canvas-build");
      if (htmlContent) {
        currentHtml = htmlContent;
        saveState(htmlContent);
      } else {
        const jsContent = extractContent(fullResponse, "canvas-patch");
        if (jsContent && iframeEl?.contentWindow) {
          iframeEl.contentWindow.postMessage(
            { type: "APPLY_PATCH", payload: jsContent },
            "*"
          );
          iframeEl.contentWindow.postMessage({ type: "SERIALIZE_HTML" }, "*");
        }
      }
    }

    chatHistory.push({
      role: "assistant",
      content: fullResponse,
      responseText: responseText ?? undefined,
    });
  } catch (err) {
    console.error("[HOST] Error:", err);
  } finally {
    isStreaming = false;
  }
}
</script>

<div class="canvas-container">
  {#if stateLoaded}
    <iframe
      bind:this={iframeEl}
      sandbox="allow-scripts"
      srcdoc={buildSrcdoc(currentHtml)}
      class="canvas-iframe"
      title="Ephemeral Canvas"
    ></iframe>
  {/if}

  <div class="floating-panel">
    <div class="chat-history">
      {#each chatHistory as msg}
        {#if msg.role === 'user'}
          <div class="msg user-msg">{msg.content}</div>
        {:else if msg.responseText}
          <div class="msg assistant-msg">{msg.responseText}</div>
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

  .assistant-msg {
    font-weight: 400;
    color: var(--text);
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
