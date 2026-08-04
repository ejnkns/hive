/// <reference types="svelte" />

// Typing for the custom events the Lit rendering surface dispatches; Svelte
// forwards them through on: handlers on the workflow-instances element. The
// export marks this file a module so the declaration below augments
// svelte/elements instead of replacing it.
export {};

declare module "svelte/elements" {
  interface HTMLAttributes<T> {
    "onhive-action"?: (
      event: CustomEvent<{
        flowId: string;
        instanceId: string;
        actionId: string;
      }>
    ) => void;
    "onhive-send-message"?: (
      event: CustomEvent<{
        flowId: string;
        instanceId: string;
        content: string;
      }>
    ) => void;
  }
}
