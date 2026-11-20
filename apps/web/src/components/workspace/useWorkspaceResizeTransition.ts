import { useLayoutEffect, useRef } from "react";
import { useStableCallback } from "../../hooks/useStableCallback";
import { notifyWorkspaceLayout, workspacePanelClip } from "../../lib/workspaceLayoutEvents";
import { usePanelAnimationSettings } from "../../panelAnimations";
import type { WorkspacePanel } from "./workspaceLayout";

function canAnimatePanel(panel: HTMLElement) {
  const hidden = panel.closest("[hidden], [inert]");
  return (
    !hidden ||
    (hidden === panel &&
      panel.matches(".workspace-docked-right[inert]:not([hidden], [data-workspace-covered])"))
  );
}

interface PanelStart {
  from: DOMRect;
  width: number;
  height: number;
  wasStage: boolean;
}

interface PanelTarget {
  panel: HTMLElement;
  surface: HTMLElement;
  start: PanelStart;
}

function frame(rect: DOMRect, destination: DOMRect, width: number, height: number): Keyframe {
  return {
    transform: `translate3d(${rect.x - destination.x}px, ${rect.y - destination.y}px, 0)`,
    clipPath: `inset(0 ${width - rect.width}px ${height - rect.height}px 0 round 10px)`,
  };
}

function animateStage(targets: PanelTarget[], timing: KeyframeAnimationOptions) {
  for (const { panel, surface, start } of targets) {
    const stage = start.wasStage || panel.hasAttribute("data-workspace-maximized-stage");
    surface.style.width = `max(100%, ${start.width}px)`;
    surface.style.height = `max(100%, ${start.height}px)`;
    panel.setAttribute("data-workspace-moving", stage ? "stage" : "panel");
  }
  const animations: Animation[] = [];
  const bounds = targets.map(({ panel }) => panel.getBoundingClientRect());
  for (const [index, { panel, surface, start }] of targets.entries()) {
    const { from } = start;
    const to = bounds[index]!;
    if (
      !to.height ||
      (from.x === to.x && from.y === to.y && from.width === to.width && from.height === to.height)
    )
      continue;
    const width = Math.max(start.width, to.width);
    const height = Math.max(start.height, to.height);
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
  return animations;
}

export function useWorkspaceResizeTransition() {
  const { active, durationMs } = usePanelAnimationSettings();
  const pending = useRef(new Map<HTMLElement, PanelStart>());
  const running = useRef<((notify?: boolean) => void) | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Release pinned stages before a route or motion preference change paints.
  useLayoutEffect(() => {
    if (active)
      return () => {
        pending.current.clear();
        running.current?.();
      };
  }, [active]);

  const capture = useStableCallback((body: HTMLElement, panels: (WorkspacePanel | null)[]) => {
    const dock = body.parentElement;
    if (!dock || !active) return;
    for (const key of new Set(panels)) {
      if (!key) continue;
      const panel = dock.querySelector<HTMLElement>(`[data-workspace-panel="${key}"]`);
      if (!panel || !canAnimatePanel(panel) || pending.current.has(panel)) continue;
      const clip = workspacePanelClip.get(panel);
      const from = clip?.() ?? panel.getBoundingClientRect();
      if (!from.height) continue;
      const pinned =
        clip &&
        panel.querySelector(":scope > [data-workspace-panel-surface]")?.getBoundingClientRect();
      pending.current.set(panel, {
        from,
        width: pinned?.width ?? from.width,
        height: pinned?.height ?? from.height,
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
    const targets: PanelTarget[] = [];
    for (const [panel, start] of before) {
      const surface = panel.querySelector<HTMLElement>(":scope > [data-workspace-panel-surface]");
      if (!surface || !panel.isConnected || !canAnimatePanel(panel)) continue;
      targets.push({ panel, surface, start });
    }
    if (!targets.length) return;
    const timing = {
      duration: durationMs,
      easing: getComputedStyle(dock).getPropertyValue("--ease-drawer").trim() || "ease-out",
      fill: "both",
    } as const;
    const animations = animateStage(targets, timing);
    dock.setAttribute("data-workspace-resizing", "");
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
      const handle = event.target instanceof Element && event.target.closest('[role="separator"]');
      if (handle) finish();
    };
    running.current = finish;
    window.addEventListener("resize", settle);
    dock.addEventListener("pointerdown", onPointerDown, true);
    notifyWorkspaceLayout();
    void Promise.all(animations.map((animation) => animation.finished)).then(settle, settle);
  });
  return { capture, play };
}
