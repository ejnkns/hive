<script lang="ts">
import { getThemeMode, setLightMode } from "./theme-state.svelte";
import Button from "./ui/Button.svelte";

let themeMode = $derived(getThemeMode());

function toggleTheme() {
  const light = !document.documentElement.classList.toggle("light");
  setLightMode(!light);
  localStorage.setItem("theme", !light ? "light" : "dark");
}
</script>

<header class="hive-header">
  <div class="brand">
    <svg class="brand-glyph" viewBox="0 0 16 16" aria-hidden="true">
      <defs>
        <path
          id="hive-hex"
          d="M3 0 L1.5 2.6 L-1.5 2.6 L-3 0 L-1.5 -2.6 L1.5 -2.6 Z"
        />
      </defs>
      <use
        href="#hive-hex"
        transform="translate(8 5.8)"
        fill="none"
        stroke="currentColor"
        stroke-width="1.1"
      />
      <use
        href="#hive-hex"
        transform="translate(4.7 11.4)"
        fill="none"
        stroke="currentColor"
        stroke-width="1.1"
      />
      <use
        href="#hive-hex"
        transform="translate(11.3 11.4)"
        fill="none"
        stroke="currentColor"
        stroke-width="1.1"
      />
    </svg>
    <a href="#/" class="brand-wordmark" aria-label="hive home">[ h i v e ]</a>
  </div>

  <div class="header-actions">
    <Button
      variant="neutral"
      size="small"
      class="theme-toggle"
      onclick={toggleTheme}
      aria-label="Toggle theme"
    >
      {themeMode === "light" ? "dark" : "light"}
    </Button>
  </div>
</header>

<style>
.hive-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  max-width: 1200px;
  margin: 0 auto;
  padding: 0.625rem 1.25rem;
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--brand);
}
.brand-glyph {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
.brand-wordmark {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--text);
  text-decoration: none;
  white-space: nowrap;
  transition: color var(--dur-fast) var(--ease-out);
}
.brand-wordmark:hover {
  color: var(--brand);
}
</style>
