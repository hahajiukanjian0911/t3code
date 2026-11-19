import { useLayoutEffect, useRef } from "react";

import { acquireBrowserSurface } from "./browserSurfaceStore";
import { subscribeWorkspaceLayout, workspacePanelClip } from "../lib/workspaceLayoutEvents";
import { observeResize } from "../lib/observeResize";

// Electron hosts the guest outside the dock. Mask its wrapper while keeping the guest viewport at its layout size.
function browserSlotClip(slot: DOMRect, panel: DOMRect, covered: boolean): string {
  const left = Math.max(0, panel.left - slot.left);
  const top = Math.max(0, panel.top - slot.top);
  const right = Math.min(slot.width, panel.right - slot.left);
  const bottom = Math.min(slot.height, panel.bottom - slot.top);
  if (left >= right || top >= bottom) return covered ? "none" : "inset(100%)";
  if (covered) {
    return `path(evenodd, "M0 0H${slot.width}V${slot.height}H0Z M${left} ${top}H${right}V${bottom}H${left}Z")`;
  }
  return `inset(${top}px ${slot.width - right}px ${slot.height - bottom}px ${left}px)`;
}

export function BrowserSurfaceSlot(props: {
  readonly tabId: string;
  readonly visible: boolean;
  readonly cornerRadius?: number;
  readonly zIndex?: number;
  readonly layoutVersion?: string | number;
  readonly className?: string;
  readonly fitSourceContent?: boolean;
}) {
  const {
    tabId,
    visible,
    cornerRadius = 0,
    zIndex = 30,
    layoutVersion,
    className,
    fitSourceContent = false,
  } = props;
  const presentationRef = useRef({ visible, cornerRadius, zIndex });
  const updateRef = useRef<(() => void) | null>(null);

  // The lease lives as long as this element for one tab, so the ref callback owns it.
  const attachSurface = (element: HTMLDivElement) => {
    let lease = acquireBrowserSurface(tabId, fitSourceContent);
    let frame = 0;
    const update = () => {
      const rect = element.getBoundingClientRect();
      const moving = element.closest<HTMLElement>("[data-workspace-moving]");
      const dock = element.closest("[data-workspace-resizing]");
      const covering =
        !moving && !element.closest('[data-workspace-panel="floating"]')
          ? dock?.querySelector<HTMLElement>('[data-workspace-moving="stage"]')
          : null;
      const mask = moving ?? covering;
      const clip = mask && workspacePanelClip.get(mask)?.();
      const bounds = {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
        ...(clip ? { clipPath: browserSlotClip(rect, clip, Boolean(covering)) } : {}),
      };
      const presentation = presentationRef.current;
      const surfaceZIndex =
        presentation.zIndex +
        (element.closest('[data-workspace-panel="floating"], [data-workspace-dragging]') ? 100 : 0);
      const visible =
        presentation.visible &&
        rect.width > 0 &&
        rect.height > 0 &&
        !element.closest("[inert], [hidden]");
      if (visible && clip && !frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          update();
        });
      }
      const presented = lease.present(bounds, visible, presentation.cornerRadius, surfaceZIndex);
      if (visible && !presented) {
        lease.release();
        lease = acquireBrowserSurface(tabId, fitSourceContent);
        lease.present(bounds, visible, presentation.cornerRadius, surfaceZIndex);
      }
    };
    updateRef.current = update;
    update();
    const observed: Element[] = [element];
    // Inline shells animate without resizing the slot, so observe the shell too.
    const panel = element.closest('[data-preview-panel-mode="inline"]');
    if (panel) observed.push(panel);
    // Sidebar width changes move the slot without changing its size or column offset.
    observed.push(...document.querySelectorAll('[data-slot="sidebar-gap"]'));
    const stopObserving = observeResize(observed, update);
    const stopWorkspaceLayout = subscribeWorkspaceLayout(update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(frame);
      stopObserving();
      stopWorkspaceLayout();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      if (updateRef.current === update) updateRef.current = null;
      lease.release();
    };
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes visibility, radius and stacking to the desktop browser surface after layout
  useLayoutEffect(() => {
    presentationRef.current = { visible, cornerRadius, zIndex };
    updateRef.current?.();
  }, [
    cornerRadius,
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A layoutVersion bump means the slot moved without resizing, so it re-presents at the new position.
    layoutVersion,
    visible,
    zIndex,
  ]);

  return <div ref={attachSurface} className={className} data-browser-surface-slot={tabId} />;
}
