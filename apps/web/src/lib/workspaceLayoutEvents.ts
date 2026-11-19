const workspaceLayoutEvent = "t3:workspace-layout";

export function notifyWorkspaceLayout() {
  window.dispatchEvent(new Event(workspaceLayoutEvent));
}

export function subscribeWorkspaceLayout(listener: () => void) {
  window.addEventListener(workspaceLayoutEvent, listener);
  return () => window.removeEventListener(workspaceLayoutEvent, listener);
}

const resizeStartEvent = "t3:workspace-resize-start";
export const workspacePanelClip = new WeakMap<HTMLElement, () => DOMRect>();

export function notifyWorkspaceResizeStart(panel: HTMLElement) {
  window.dispatchEvent(new CustomEvent(resizeStartEvent, { detail: panel }));
}

export function subscribeWorkspaceResizeStart(listener: (panel: HTMLElement) => void) {
  const onStart = (event: Event) => listener((event as CustomEvent<HTMLElement>).detail);
  window.addEventListener(resizeStartEvent, onStart);
  return () => window.removeEventListener(resizeStartEvent, onStart);
}
