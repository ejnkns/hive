export const projectHeader = $state({
  projectId: "",
  panelOpen: false,
  requirementsContent: "",
});

export function togglePanel() {
  projectHeader.panelOpen = !projectHeader.panelOpen;
}

export function closePanel() {
  projectHeader.panelOpen = false;
}
