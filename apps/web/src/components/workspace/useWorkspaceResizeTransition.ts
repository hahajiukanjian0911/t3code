import { useLayoutEffect, useRef } from "react";
import { useStableCallback } from "../../hooks/useStableCallback";
import {
  notifyWorkspaceLayout,
  notifyWorkspaceResizeStart,
  workspacePanelClip,
} from "../../lib/workspaceLayoutEvents";
import { usePanelAnimationSettings } from "../../panelAnimations";
import type { WorkspacePanel } from "./workspaceLayout";

function frame(rect: DOMRect, destination: DOMRect, width: number, height: number): Keyframe {
  return {
    transform: `translate3d(${rect.x - destination.x}px, ${rect.y - destination.y}px, 0)`,
    clipPath: `inset(0 ${width - rect.width}px ${height - rect.height}px 0 round 10px)`,
  };
}

export function useWorkspaceResizeTransition() {
  const { active, durationMs } = usePanelAnimationSettings();
  const pending = useRef(new Map<HTMLElement, { from: DOMRect; wasStage: boolean }>());
  const running = useRef<((notify?: boolean) => void) | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Release pinned surfaces when motion preferences change or the workspace unmounts.
  useLayoutEffect(() => {
    if (active)
      return () => {
        pending.current.clear();
        running.current?.();
      };
  }, [active]);

  const capture = useStableCallback((body: HTMLElement, panels: (WorkspacePanel | null)[]) => {
    const dock = body.parentElement;
    if (!dock) return;
    for (const key of new Set(panels)) {
      if (!key) continue;
      const panel = dock.querySelector<HTMLElement>(`[data-workspace-panel="${key}"]`);
      if (!panel || panel.closest("[hidden], [inert]") || pending.current.has(panel)) continue;
      notifyWorkspaceResizeStart(panel);
      if (!active) continue;
      const rect = workspacePanelClip.get(panel)?.() ?? panel.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      pending.current.set(panel, {
        from: rect,
        wasStage: panel.hasAttribute("data-workspace-maximized-stage"),
      });
    }
  });

  const play = useStableCallback(() => {
    if (!pending.current.size) return;
    const before = pending.current;
    pending.current = new Map();
    running.current?.(false);
    const dock = before.keys().next().value?.closest<HTMLElement>("[data-workspace-dock]");
    if (!dock || !active) return;
    const targets: { panel: HTMLElement; surface: HTMLElement; from: DOMRect }[] = [];
    for (const entry of before) {
      const panel = entry[0];
      const { from, wasStage } = entry[1];
      const surface = panel.querySelector<HTMLElement>(":scope > [data-workspace-panel-surface]");
      if (!surface || !panel.isConnected || panel.closest("[hidden], [inert]")) continue;
      const stage = wasStage || panel.hasAttribute("data-workspace-maximized-stage");
      // Pin before measuring the grid so the browser lays out text only at the larger endpoint.
      surface.style.width = `max(100%, ${from.width}px)`;
      surface.style.height = `max(100%, ${from.height}px)`;
      panel.setAttribute("data-workspace-moving", stage ? "stage" : "panel");
      targets.push({ panel, surface, from });
    }
    if (!targets.length) return;
    dock.setAttribute("data-workspace-resizing", "");
    const timing = {
      duration: durationMs,
      easing: getComputedStyle(dock).getPropertyValue("--ease-drawer").trim() || "ease-out",
      fill: "both",
    } as const;
    const animations: Animation[] = [];
    const bounds = targets.map(({ panel }) => panel.getBoundingClientRect());
    for (let index = 0; index < targets.length; index++) {
      const { panel, surface, from } = targets[index]!;
      const to = bounds[index]!;
      if (
        !to.width ||
        !to.height ||
        (from.x === to.x && from.y === to.y && from.width === to.width && from.height === to.height)
      )
        continue;
      const width = Math.max(from.width, to.width);
      const height = Math.max(from.height, to.height);
      const animation = surface.animate(
        [frame(from, to, width, height), frame(to, to, width, height)],
        timing,
      );
      animations.push(animation);
      const handle = panel.querySelector<HTMLElement>(':scope > [role="separator"]');
      if (handle) {
        const dx = panel.dataset.workspacePanel === "left" ? from.right - to.right : from.x - to.x;
        animations.push(
          handle.animate(
            [{ transform: `translate(${dx}px, ${from.y - to.y}px)` }, { transform: "none" }],
            timing,
          ),
        );
      }
      workspacePanelClip.set(panel, () => {
        const progress = animation.effect?.getComputedTiming().progress ?? 0;
        return new DOMRect(
          from.x + (to.x - from.x) * progress,
          from.y + (to.y - from.y) * progress,
          from.width + (to.width - from.width) * progress,
          from.height + (to.height - from.height) * progress,
        );
      });
    }
    const finish = (notify = true) => {
      if (running.current !== finish) return;
      running.current = null;
      window.removeEventListener("resize", settle);
      dock.removeEventListener("pointerdown", onPointerDown, true);
      for (const animation of animations) animation.cancel();
      for (const { panel, surface } of targets) {
        workspacePanelClip.delete(panel);
        panel.removeAttribute("data-workspace-moving");
        surface.style.width = "";
        surface.style.height = "";
      }
      dock.removeAttribute("data-workspace-resizing");
      if (notify) notifyWorkspaceLayout();
    };
    const settle = () => finish();
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('[role="separator"]')) finish();
    };
    running.current = finish;
    window.addEventListener("resize", settle);
    dock.addEventListener("pointerdown", onPointerDown, true);
    notifyWorkspaceLayout();
    void Promise.all(animations.map((animation) => animation.finished)).then(settle, settle);
  });
  return { capture, play };
}
