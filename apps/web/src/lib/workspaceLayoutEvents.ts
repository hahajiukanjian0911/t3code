const workspaceLayoutEvent = "t3:workspace-layout";

export function notifyWorkspaceLayout() {
  window.dispatchEvent(new Event(workspaceLayoutEvent));
}

export function subscribeWorkspaceLayout(listener: () => void) {
  window.addEventListener(workspaceLayoutEvent, listener);
  return () => window.removeEventListener(workspaceLayoutEvent, listener);
}
