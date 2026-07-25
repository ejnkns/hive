export function jellyDisabled(node: HTMLElement, disabled: boolean) {
  function update(d: boolean) {
    if (d) {
      node.setAttribute("disabled", "");
      node.style.setProperty("opacity", "0.3");
      node.style.setProperty("pointer-events", "none");
    } else {
      node.removeAttribute("disabled");
      node.style.removeProperty("opacity");
      node.style.removeProperty("pointer-events");
    }
  }
  update(disabled);
  return { update };
}
