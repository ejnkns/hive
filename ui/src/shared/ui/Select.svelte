<script lang="ts">
import { Select as BitsSelect } from "bits-ui";

type Item = { value: string; label: string; disabled?: boolean };

type Props = {
  value?: string;
  onValueChange?: (value: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onOpenChangeComplete?: (open: boolean) => void;
  disabled?: boolean;
  name?: string;
  required?: boolean;
  allowDeselect?: boolean;
  loop?: boolean;
  scrollAlignment?: "nearest" | "center";
  items: Item[];
  placeholder?: string;
  size?: "small" | "default";
};

let {
  items,
  placeholder,
  disabled = false,
  size = "small",
  value = $bindable(""),
  open = $bindable(false),
  ...restProps
}: Props = $props();
</script>

<BitsSelect.Root
  type="single"
  bind:value
  bind:open
  {disabled}
  {items}
  {...restProps}
>
  <BitsSelect.Trigger
    class="hive-select-trigger hive-select-{size}"
    {disabled}
  >
    <BitsSelect.Value {placeholder} />
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      class="hive-select-chevron"
      aria-hidden="true"
    >
      <path
        d="M2 3l3 4 3-4"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      />
    </svg>
  </BitsSelect.Trigger>
  <BitsSelect.Portal>
    <BitsSelect.Content class="hive-select-content" sideOffset={4}>
      <BitsSelect.Viewport>
        {#each items as item (item.value)}
          <BitsSelect.Item
            value={item.value}
            label={item.label}
            disabled={item.disabled}
            class="hive-select-item"
          >
            {#snippet children({ selected })}
              {item.label}
              {#if selected}
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  aria-hidden="true"
                  class="hive-select-check"
                >
                  <path
                    d="M2 6l3 3 5-6"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                  />
                </svg>
              {/if}
            {/snippet}
          </BitsSelect.Item>
        {/each}
      </BitsSelect.Viewport>
    </BitsSelect.Content>
  </BitsSelect.Portal>
</BitsSelect.Root>

<style>
:global(.hive-select-trigger) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  font-family: monospace;
  min-width: 100px;
}
:global(.hive-select-trigger:hover) {
  border-color: var(--accent);
}
:global(.hive-select-trigger[disabled]) {
  opacity: 0.3;
  pointer-events: none;
}

:global(.hive-select-small) {
  height: 28px;
  padding: 0 8px;
  font-size: 0.6875rem;
}

:global(.hive-select-default) {
  height: 36px;
  padding: 0 12px;
  font-size: 0.8125rem;
}

:global(.hive-select-chevron) {
  flex-shrink: 0;
  opacity: 0.5;
  margin-left: auto;
}

:global(.hive-select-content) {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  max-height: 240px;
  overflow-y: auto;
  padding: 4px;
  z-index: 999;
  min-width: var(--bits-select-anchor-width);
}

:global(.hive-select-item) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 0.6875rem;
  color: var(--text);
  cursor: pointer;
  outline: none;
}
:global(.hive-select-item[data-highlighted]) {
  background: var(--surface);
}
:global(.hive-select-item[data-disabled]) {
  opacity: 0.3;
  pointer-events: none;
}

:global(.hive-select-check) {
  flex-shrink: 0;
  color: var(--accent);
}
</style>
