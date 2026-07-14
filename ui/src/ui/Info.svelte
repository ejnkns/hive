<script lang="ts">
let { children } = $props();
</script>

<button popovertarget="pop" type="button" class="info-btn" aria-label="More info">i</button>
<div id="pop" popover="auto" class="info-popover" role="tooltip">
  {@render children()}
</div>

<style>
  .info-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1rem;
    height: 1rem;
    border: 1px solid var(--muted);
    background: transparent;
    color: var(--muted);
    font-size: 0.5625rem;
    cursor: pointer;
    border-radius: 50%;
    font: inherit;
    line-height: 1;
    padding: 0;
    vertical-align: middle;
    margin-left: 0.25rem;
    flex-shrink: 0;
    text-transform: none;
    letter-spacing: 0;
  }
  .info-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .info-popover {
    border: 1px solid var(--border);
    background: var(--card);
    color: var(--text);
    font-size: 0.75rem;
    padding: 0.5rem 0.75rem;
    max-width: 260px;
    line-height: 1.4;
    font-family: monospace;
  }
</style>
