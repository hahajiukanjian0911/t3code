import { useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { useStableCallback } from "../../hooks/useStableCallback";
import { notifyWorkspaceLayout } from "../../lib/workspaceLayoutEvents";
import { usePanelAnimationSettings } from "../../panelAnimations";

function measurePanes(dock: HTMLElement) {
  const panes = new Map<string, { node: HTMLElement; rect: DOMRect; opacity: number }>();
  for (const node of dock.querySelectorAll<HTMLElement>("[data-workspace-resize-window]")) {
    if (node.closest("[inert]") && !node.hasAttribute("data-workspace-parked-window")) continue;
    const rect = node.getBoundingClientRect();
    if (rect.width && rect.height) {
      panes.set(node.dataset.workspaceResizeWindow!, {
        node,
        rect,
        opacity: Number(getComputedStyle(node).opacity),
      });
    }
  }
  return panes;
}

function paneFrame(rect: DOMRect): Keyframe {
  return {
    position: "fixed",
    inset: "auto",
    margin: "0",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    maxWidth: "none",
    maxHeight: "none",
    zIndex: "20",
  };
}

export function useWorkspaceResizeTransition() {
  const { active, durationMs } = usePanelAnimationSettings();
  const running = useRef<(() => void) | null>(null);
  const parkedTimelines = useRef(
    new WeakMap<HTMLElement, { window: string; top: number; atEnd: boolean }>(),
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Release the temporary pane geometry on unmount or motion preference changes.
  useLayoutEffect(() => {
    if (active) return () => running.current?.();
  }, [active]);

  return useStableCallback((dock: HTMLElement | null, resize: () => void) => {
    if (!dock) {
      resize();
      return;
    }
    const timelines = dock.querySelectorAll<HTMLElement>(".messages-timeline-scroll");
    for (const node of timelines) {
      const owner = node.closest<HTMLElement>("[data-workspace-window]")?.dataset.workspaceWindow;
      if (!owner || !node.clientHeight || node.closest("[inert]")) continue;
      parkedTimelines.current.set(node, {
        window: owner,
        top: node.scrollTop,
        atEnd: node.scrollHeight - node.clientHeight - node.scrollTop <= 1,
      });
    }
    const restoreTimelines = () => {
      // Moving the portal through its parking slot can reset a live scroller to zero.
      for (const node of dock.querySelectorAll<HTMLElement>(".messages-timeline-scroll")) {
        const position = parkedTimelines.current.get(node);
        if (!position || !node.clientHeight || node.closest("[inert]")) continue;
        parkedTimelines.current.delete(node);
        if (
          node.closest<HTMLElement>("[data-workspace-window]")?.dataset.workspaceWindow !==
          position.window
        )
          continue;
        node.scrollTo({
          top: position.atEnd ? node.scrollHeight : position.top,
          behavior: "instant",
        });
      }
    };
    const before = active ? measurePanes(dock) : null;
    running.current?.();
    flushSync(resize);
    if (!before) {
      restoreTimelines();
      return;
    }
    const after = measurePanes(dock);
    const animations: Animation[] = [];
    const timing = {
      duration: durationMs,
      easing: getComputedStyle(dock).getPropertyValue("--ease-drawer").trim() || "ease-out",
      fill: "both",
    } as const;
    for (const entry of after) {
      const [id, { node, rect }] = entry;
      const old = before.get(id);
      // Pin every visible group so flex siblings keep their own bounds until the dock takes over.
      const frames = [
        { ...paneFrame(old?.rect ?? rect), opacity: old?.opacity ?? 0 },
        { ...paneFrame(rect), opacity: 1 },
      ];
      animations.push(node.animate(frames, timing));
    }

    for (const node of dock.querySelectorAll<HTMLElement>("[data-workspace-parked-window]")) {
      const previous = before.get(node.dataset.workspaceResizeWindow!);
      if (!previous) continue;
      const frame = {
        ...paneFrame(previous.rect),
        display: "block",
        zIndex: "1",
      };
      animations.push(
        node.animate(
          [
            { ...frame, opacity: previous.opacity },
            { ...frame, opacity: 0 },
          ],
          timing,
        ),
      );
    }

    restoreTimelines();
    let frame = 0;
    const finish = () => {
      if (running.current !== finish) return;
      running.current = null;
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", finish);
      for (const animation of animations) animation.cancel();
      notifyWorkspaceLayout();
    };
    const syncNativeSurfaces = () => {
      notifyWorkspaceLayout();
      frame = requestAnimationFrame(syncNativeSurfaces);
    };
    running.current = finish;
    window.addEventListener("resize", finish);
    if (dock.querySelector("[data-browser-surface-slot]")) syncNativeSurfaces();
    void Promise.all(animations.map((animation) => animation.finished)).then(finish, finish);
  });
}
