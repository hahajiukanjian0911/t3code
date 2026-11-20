import { useLayoutEffect, useRef } from "react";
import { usePanelAnimationSettings } from "../../panelAnimations";

export function useDockedPanelMotion(
  getBody: () => HTMLDivElement | null,
  leftOpen: boolean,
  rightTab: string | undefined,
  maximized: boolean,
) {
  const { dockedEntryActive, durationMs } = usePanelAnimationSettings();
  const previous = useRef({ leftOpen, rightTab, maximized });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Animate the incoming controls after docking commits, with native guest bounds already final.
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = { leftOpen, rightTab, maximized };
    const body = getBody();
    if (!body || !dockedEntryActive || maximized || before.maximized) return;
    const animations: Animation[] = [];
    const enter = (selector: string, offset: number) => {
      const controls = body.querySelector<HTMLElement>(selector);
      if (controls) {
        animations.push(
          controls.animate(
            [
              { transform: `translateX(${offset}px)`, opacity: 0.84 },
              { transform: "none", opacity: 1 },
            ],
            { duration: Math.min(durationMs, 105), easing: "cubic-bezier(.2,.7,.25,1)" },
          ),
        );
      }
    };
    if (leftOpen && !before.leftOpen)
      enter('[data-workspace-panel="left"] [data-slot="sidebar-content"]', -5);
    if (rightTab && before.rightTab !== rightTab)
      enter('[data-workspace-panel-heading="right"] [role="tablist"]', 5);
    return () => {
      for (const animation of animations) animation.cancel();
    };
  }, [getBody, leftOpen, rightTab, maximized, dockedEntryActive, durationMs]);
}
