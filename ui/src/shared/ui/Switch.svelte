<script lang="ts">
import {
  Switch as BitsSwitch,
  Label,
  useId,
  type WithoutChildrenOrChild,
} from "bits-ui";

type Props = WithoutChildrenOrChild<BitsSwitch.RootProps> & {
  label?: string;
};

let {
  label,
  checked = $bindable(false),
  disabled = false,
  id = useId(),
  ...restProps
}: Props = $props();
</script>

<div class="hive-switch-wrap">
  <BitsSwitch.Root
    bind:checked
    {disabled}
    {id}
    {...restProps}
    class="hive-switch-root"
  >
    <BitsSwitch.Thumb class="hive-switch-thumb" />
  </BitsSwitch.Root>
  {#if label}
    <Label.Root for={id} class="hive-switch-label">{label}</Label.Root>
  {/if}
</div>

<style>
:global(.hive-switch-wrap) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

:global(.hive-switch-root) {
  width: 36px;
  height: 20px;
  border-radius: 999px; /* pill — sole exception to the radius scale (switch affordance) */
  background: var(--border);
  border: none;
  cursor: pointer;
  position: relative;
  transition: background var(--dur-fast) var(--ease-out);
  padding: 0;
}
:global(.hive-switch-root[data-state="checked"]) {
  background: var(--accent);
}
:global(.hive-switch-root[disabled]) {
  opacity: 0.4;
  cursor: not-allowed;
  pointer-events: none;
}

:global(.hive-switch-thumb) {
  display: block;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--text);
  transition: transform var(--dur-fast) var(--ease-out);
  transform: translateX(2px);
}
:global(.hive-switch-thumb[data-state="checked"]) {
  transform: translateX(18px);
}

:global(.hive-switch-label) {
  font-size: var(--text-xs);
  color: var(--text);
  cursor: pointer;
  user-select: none;
}
</style>
