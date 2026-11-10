interface SidebarHoverStore {
  getSnapshot: () => { readonly open: boolean; readonly peek: boolean };
  setPeek: (peek: boolean) => void;
  isHeld: () => boolean;
  subscribe: (listener: () => void) => () => void;
}

export function observeSidebarHoverReveal(wrapper: HTMLElement, store: SidebarHoverStore) {
  const sidebar = wrapper.querySelector<HTMLElement>(
    '[data-slot="sidebar"][data-side="left"][data-collapsible-mode="offcanvas"]',
  );
  if (!sidebar) return;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  let active = true;
  let atEdge = false;
  let inside = false;
  let pressed = false;
  let dismissed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: boolean | undefined;
  const clearTimer = () => {
    clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  };
  const isInteracting = () =>
    pressed ||
    store.isHeld() ||
    (sidebar.contains(document.activeElement) &&
      document.activeElement?.matches(
        'input, textarea, [contenteditable="true"], [role="textbox"]',
      )) ||
    sidebar.querySelector('[aria-haspopup][aria-expanded="true"], [data-popup-open]') !== null;
  const shouldOpen = () => finePointer.matches && atEdge && !pressed && !dismissed;
  const shouldStayOpen = () => inside || atEdge || isInteracting();
  const reconcile = () => {
    if (!active) return;
    const { open, peek } = store.getSnapshot();
    if (open || !finePointer.matches || (peek ? shouldStayOpen() : !shouldOpen())) {
      clearTimer();
      if (!finePointer.matches) store.setPeek(false);
      return;
    }
    const next = !peek;
    if (pending === next) return;
    clearTimer();
    pending = next;
    timer = setTimeout(
      () => {
        timer = undefined;
        pending = undefined;
        if (store.getSnapshot().open) return;
        if (next ? shouldOpen() : !shouldStayOpen()) store.setPeek(next);
      },
      next ? 150 : 300,
    );
  };
  const updatePointer = (event: PointerEvent | DragEvent) => {
    atEdge =
      event.clientX >= 0 &&
      event.clientX < 6 &&
      event.clientY >= 0 &&
      event.clientY < window.innerHeight;
    const target = store.getSnapshot().peek
      ? document.elementFromPoint(event.clientX, event.clientY)
      : null;
    inside =
      store.getSnapshot().peek &&
      (sidebar.contains(target) ||
        (target instanceof Element && target.closest("[data-sidebar-control]") !== null));
    if (!atEdge) dismissed = false;
    reconcile();
  };
  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    if (store.getSnapshot().open) return;
    pressed = event.buttons !== 0;
    updatePointer(event);
  };
  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    pressed = true;
    updatePointer(event);
  };
  const onPointerUp = (event: PointerEvent | DragEvent) => {
    if ("pointerType" in event && event.pointerType !== "mouse") return;
    pressed = false;
    updatePointer(event);
  };
  const onPointerOut = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    if (event.relatedTarget !== null) return;
    atEdge = false;
    inside = false;
    reconcile();
  };
  const onFocus = () => queueMicrotask(reconcile);
  const onBlur = () => {
    atEdge = false;
    inside = false;
    pressed = false;
    reconcile();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      event.key !== "Escape" ||
      event.defaultPrevented ||
      !store.getSnapshot().peek ||
      isInteracting()
    )
      return;
    dismissed = true;
    clearTimer();
    store.setPeek(false);
    event.preventDefault();
  };
  const observer = new MutationObserver(reconcile);
  observer.observe(sidebar, {
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-expanded", "data-popup-open"],
  });
  const unsubscribe = store.subscribe(reconcile);
  document.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("pointercancel", onPointerUp, true);
  document.addEventListener("pointerout", onPointerOut);
  document.addEventListener("dragend", onPointerUp, true);
  document.addEventListener("focusin", onFocus);
  document.addEventListener("focusout", onFocus);
  document.addEventListener("keydown", onKeyDown);
  window.addEventListener("blur", onBlur);
  finePointer.addEventListener("change", reconcile);
  return () => {
    active = false;
    unsubscribe();
    observer.disconnect();
    clearTimer();
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("pointerup", onPointerUp, true);
    document.removeEventListener("pointercancel", onPointerUp, true);
    document.removeEventListener("pointerout", onPointerOut);
    document.removeEventListener("dragend", onPointerUp, true);
    document.removeEventListener("focusin", onFocus);
    document.removeEventListener("focusout", onFocus);
    document.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("blur", onBlur);
    finePointer.removeEventListener("change", reconcile);
    store.setPeek(false);
  };
}
