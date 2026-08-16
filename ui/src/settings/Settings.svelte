<script lang="ts">
import { setLightMode } from "../shared/theme-state.svelte";
import Button from "../shared/ui/Button.svelte";
import Select from "../shared/ui/Select.svelte";
import Switch from "../shared/ui/Switch.svelte";

let {
  serverAddr = "—",
  onOpenModelPriority = (() => {}) as () => void,
}: {
  serverAddr?: string;
  onOpenModelPriority?: () => void;
} = $props();

function getThemeMode(): "dark" | "light" {
  return document.documentElement.classList.contains("light")
    ? "light"
    : "dark";
}

let themeMode = $state(getThemeMode());

function setTheme(value: string) {
  const light = value === "light";
  document.documentElement.classList.toggle("light", light);
  setLightMode(light);
  localStorage.setItem("theme", value);
  themeMode = getThemeMode();
}

function getCanvasEnabled(): boolean {
  return localStorage.getItem("hive-canvas-enabled") !== "0";
}

let canvasEnabled = $state(getCanvasEnabled());

function setCanvasEnabled(v: boolean) {
  canvasEnabled = v;
  localStorage.setItem("hive-canvas-enabled", v ? "1" : "0");
}

const themeItems = [
  { value: "dark", label: "dark" },
  { value: "light", label: "light" },
];
</script>

<div class="settings">
  <h1 class="page-title">settings</h1>

  <section class="section">
    <h2 class="section-title">Appearance</h2>
    <div class="row">
      <div class="row-copy">
        <span class="row-label">theme</span>
        <span class="row-note">dark and light are co-equal citizens</span>
      </div>
      <Select items={themeItems} value={themeMode} onValueChange={setTheme} />
    </div>
  </section>

  <section class="section">
    <h2 class="section-title">Routing</h2>
    <div class="row">
      <div class="row-copy">
        <span class="row-label">model priority</span>
        <span class="row-note">cascade order tried before auto-routing</span>
      </div>
      <Button variant="neutral" onclick={onOpenModelPriority}>
        configure
      </Button>
    </div>
  </section>

  <section class="section">
    <h2 class="section-title">Experiments</h2>
    <div class="row">
      <div class="row-copy">
        <span class="row-label">ephemeral canvas</span>
        <span class="row-note">
          {canvasEnabled ? "enabled — reachable at #/canvas" : "disabled"}
        </span>
      </div>
      <Switch
        checked={canvasEnabled}
        onCheckedChange={setCanvasEnabled}
        label={canvasEnabled ? "on" : "off"}
      />
    </div>
  </section>

  <section class="section">
    <h2 class="section-title">server</h2>
    <div class="row">
      <div class="row-copy">
        <span class="row-label">address</span>
        <span class="row-note">read-only</span>
      </div>
      <code class="addr">{serverAddr}</code>
    </div>
  </section>
</div>

<style>
.settings {
  max-width: 720px;
  margin: 0 auto;
  padding: var(--space-6) 1.25rem;
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.page-title {
  font-size: var(--text-lg);
  font-weight: 700;
  margin: 0;
}

.section {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--card);
  padding: var(--space-4);
}

.section-title {
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--muted);
  margin: 0 0 var(--space-3);
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

.row-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.row-label {
  font-size: var(--text-sm);
  font-weight: 600;
}

.row-note {
  font-size: var(--text-xs);
  color: var(--muted);
}

.addr {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 4px var(--space-2);
}
</style>
