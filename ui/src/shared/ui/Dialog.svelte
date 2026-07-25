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
    <BitsDialog.Overlay class="dialog-overlay" />
    <BitsDialog.Content
      class="dialog-content"
      style={contentMaxWidth ? `max-width: ${contentMaxWidth}` : undefined}
      aria-label={label}
    >
      {@render children?.()}
      <BitsDialog.Close class="dialog-close" aria-label="Close">
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
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.12);
}

.dialog-content {
  position: fixed;
  left: 50%;
  top: 50%;
  z-index: 101;
  transform: translate(-50%, -50%);
  width: calc(100% - 2rem);
  max-width: 480px;
  max-height: calc(100vh - 4rem);
  overflow-y: auto;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1.25rem;
  box-shadow:
    0 0 80px rgba(var(--accent-rgb), 0.15),
    0 8px 32px rgba(0, 0, 0, 0.4);
}

.dialog-close {
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
.dialog-close:hover {
  background: var(--surface);
  color: var(--text);
}
</style>
