import { createContext, useContext, useEffect, useState } from "react";
import { type PanelAnimationDurationMs } from "@t3tools/contracts/settings";

import { useMediaQuery } from "./hooks/useMediaQuery";
import { useClientSettings } from "./hooks/useSettings";

type NavigationSuppression = "route" | "thread-switch" | null;
const PanelAnimationSuppressionContext = createContext<NavigationSuppression>(null);

export const PanelAnimationSuppressionProvider = PanelAnimationSuppressionContext.Provider;

export function usePanelNavigationSuppression(
  pathname: string,
  thread: boolean,
): NavigationSuppression {
  const [painted, setPainted] = useState<{ pathname: string; thread: boolean } | null>(null);
  const suppressed = painted?.pathname !== pathname;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Wait two browser frames so the new route paints before panel animations are re-enabled; cancel the frames on change or unmount.
  useEffect(() => {
    if (!suppressed) return;
    let releaseFrame = 0;
    const paintFrame = window.requestAnimationFrame(() => {
      releaseFrame = window.requestAnimationFrame(() => setPainted({ pathname, thread }));
    });
    return () => {
      window.cancelAnimationFrame(paintFrame);
      window.cancelAnimationFrame(releaseFrame);
    };
  }, [pathname, thread, suppressed]);

  if (!suppressed) return null;
  return thread && painted?.thread ? "thread-switch" : "route";
}

export function usePanelAnimationSettings(): {
  active: boolean;
  dockedEntryActive: boolean;
  durationMs: PanelAnimationDurationMs;
} {
  const durationMs = useClientSettings((settings) => settings.panelAnimationDurationMs);
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const suppression = useContext(PanelAnimationSuppressionContext);
  const enabled = durationMs > 0 && !prefersReducedMotion;
  return {
    active: enabled && suppression === null,
    dockedEntryActive: enabled && suppression !== "route",
    durationMs,
  };
}

export function usePanelPresence<T>(
  open: boolean,
  value: T | null,
  animated: boolean,
  scopeKey: string | null,
  durationMs: PanelAnimationDurationMs,
): { present: boolean; value: T | null } {
  const [present, setPresent] = useState(open);
  const [retained, setRetained] = useState<{ scopeKey: string | null; value: T | null } | null>(
    open ? { scopeKey, value } : null,
  );
  if (open && (retained?.scopeKey !== scopeKey || retained.value !== value)) {
    setRetained({ scopeKey, value });
  }

  if (open && !present) setPresent(true);
  if (!open && !animated && present) setPresent(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keep the closing panel mounted for its CSS exit transition, then unmount it; the timer is cleared on reopen or unmount.
  useEffect(() => {
    if (open || !animated) return;
    const timeout = window.setTimeout(() => setPresent(false), durationMs);
    return () => window.clearTimeout(timeout);
  }, [animated, durationMs, open]);

  const retainedValue = retained?.scopeKey === scopeKey ? retained.value : null;
  const visible = open || (animated && present && retained?.scopeKey === scopeKey);
  return { present: visible, value: open ? value : visible ? retainedValue : null };
}
