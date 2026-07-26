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
  width: 32px;
  height: 18px;
  border-radius: 999px;
  background: var(--border);
  border: none;
  cursor: pointer;
  position: relative;
  transition: background 0.15s;
  padding: 0;
}
:global(.hive-switch-root[data-state="checked"]) {
  background: var(--accent);
}
:global(.hive-switch-root[disabled]) {
  opacity: 0.3;
  pointer-events: none;
}

:global(.hive-switch-thumb) {
  display: block;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--text);
  transition: transform 0.15s;
  transform: translateX(2px);
}
:global(.hive-switch-thumb[data-state="checked"]) {
  transform: translateX(16px);
}

:global(.hive-switch-label) {
  font-size: 0.6875rem;
  color: var(--text);
  cursor: pointer;
  user-select: none;
}
</style>
