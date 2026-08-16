<script lang="ts">
import { Dialog as BitsDialog, type WithoutChildrenOrChild } from "bits-ui";

type Props = WithoutChildrenOrChild<BitsDialog.RootProps> & {
  label: string;
  contentMaxWidth?: string;
  children?: import("svelte").Snippet;
};

let {
  label,
  contentMaxWidth,
  open = $bindable(false),
  children,
  ...restProps
}: Props = $props();
</script>

<BitsDialog.Root bind:open {...restProps}>
  <BitsDialog.Portal>
    <BitsDialog.Overlay class="hive-dialog-overlay" />
    <BitsDialog.Content
      class="hive-dialog-content"
      style={contentMaxWidth ? `max-width: ${contentMaxWidth}` : undefined}
      aria-label={label}
    >
      {@render children?.()}
      <BitsDialog.Close class="hive-dialog-close" aria-label="Close">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M4 4l8 8M12 4l-8 8"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          />
        </svg>
      </BitsDialog.Close>
    </BitsDialog.Content>
  </BitsDialog.Portal>
</BitsDialog.Root>

<style>
:global(.hive-dialog-overlay) {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: var(--overlay);
  animation: dialog-fade-in var(--dur) var(--ease-out);
}

:global(.hive-dialog-content) {
  position: fixed;
  left: 50%;
  top: 50%;
  z-index: 1001;
  transform: translate(-50%, -50%);
  width: calc(100% - 2rem);
  max-width: 480px;
  max-height: calc(100vh - 4rem);
  overflow-y: auto;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 1.25rem;
  box-shadow:
    0 0 80px rgba(var(--accent-rgb), 0.12),
    0 8px 32px rgba(0, 0, 0, 0.4);
  animation: dialog-rise-in var(--dur) var(--ease-out);
}

@keyframes dialog-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes dialog-rise-in {
  from {
    opacity: 0;
    transform: translate(-50%, calc(-50% + 4px));
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%);
  }
}

:global(.hive-dialog-close) {
  position: absolute;
  top: 8px;
  right: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
:global(.hive-dialog-close:hover) {
  background: var(--surface);
  color: var(--text);
}
</style>
