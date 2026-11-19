import { useLayoutEffect, useRef } from "react";
import { notifyWorkspaceLayout } from "../../lib/workspaceLayoutEvents";
import { usePanelAnimationSettings } from "../../panelAnimations";

interface Spring {
  value: number;
  velocity: number;
}

// Critically damped frequency tuned against the 0.375s reference scale so the panel
// launches briskly, never overshoots, and converges smoothly before durationMs elapses.
const POSITION_FREQUENCY = (2 * Math.PI) / 0.23;
const OPACITY_FREQUENCY = (2 * Math.PI) / 0.18;
const activeDockAnimations = new WeakMap<HTMLElement, number>();

function beginDockAnimation(body: HTMLElement) {
  const next = (activeDockAnimations.get(body) ?? 0) + 1;
  activeDockAnimations.set(body, next);
  if (next === 1) {
    body.setAttribute("data-dock-animating", "true");
  }
}

function endDockAnimation(body: HTMLElement) {
  const current = activeDockAnimations.get(body) ?? 0;
  if (current <= 1) {
    activeDockAnimations.delete(body);
    body.removeAttribute("data-dock-animating");
  } else {
    activeDockAnimations.set(body, current - 1);
  }
}

function step(spring: Spring, target: number, dt: number, frequency: number, damping: number) {
  const acceleration =
    frequency * frequency * (target - spring.value) - 2 * damping * frequency * spring.velocity;
  spring.velocity += acceleration * dt;
  spring.value += spring.velocity * dt;
}

export function useDockedPanelMotion(
  getBody: () => HTMLDivElement | null,
  edge: "left" | "right",
  open: boolean | null,
  size: number,
) {
  const { active, durationMs } = usePanelAnimationSettings();
  const motion = useRef<{ position: Spring; opacity: Spring } | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Synchronize the panel and its live layout before paint, retaining both spring velocities on reversal.
  useLayoutEffect(() => {
    const body = getBody();
    const panel = body?.querySelector<HTMLElement>(`:scope > [data-workspace-panel="${edge}"]`);
    if (open === null || !body || !panel) {
      motion.current = null;
      return;
    }

    const target = Number(open);
    if (motion.current === null) {
      motion.current = {
        position: { value: target, velocity: 0 },
        opacity: { value: target, velocity: 0 },
      };
    }
    const { position, opacity } = motion.current;
    let frame = 0;
    let markedAnimating = false;
    const releaseAnimating = () => {
      if (!markedAnimating) return;
      markedAnimating = false;
      endDockAnimation(body);
    };
    const track = `--workspace-${edge}-track`;
    const reserve = (p: number) => {
      if (edge === "left") {
        body.style.paddingLeft = p ? `calc(${size * p}px + ${1 + p} * var(--workspace-seam))` : "";
      } else {
        const space = p ? `calc(${size * p}px + ${p} * var(--workspace-seam))` : "";
        body.style.setProperty(track, space);
      }
    };
    const paint = () => {
      const clamped = Math.max(0, Math.min(1, position.value));
      reserve(clamped);
      if (edge === "left") {
        panel.style.transform = `translate3d(calc(${clamped - 1} * (100% + 2 * var(--workspace-seam))), 0, 0)`;
      } else {
        panel.style.transform = `translate3d(${((1 - clamped) * 18).toFixed(2)}px, 0, 0)`;
      }
      panel.style.opacity = String(Math.max(0, Math.min(1, opacity.value)));
      notifyWorkspaceLayout();
    };
    const settle = () => {
      position.value = opacity.value = target;
      position.velocity = opacity.velocity = 0;
      reserve(target);
      panel.removeAttribute("data-dock-moving");
      panel.style.transform = "";
      panel.style.opacity = "";
      releaseAnimating();
      notifyWorkspaceLayout();
    };

    const needsMotion = position.value !== target || position.velocity !== 0;

    if (active && needsMotion) {
      panel.setAttribute("data-dock-moving", "");
      markedAnimating = true;
      beginDockAnimation(body);
      const start = performance.now();
      let previous = start;
      const tick = (now: number) => {
        if (
          now - start >= durationMs ||
          (Math.abs(target - position.value) < 0.001 &&
            Math.abs(position.velocity) < 0.01 &&
            Math.abs(target - opacity.value) < 0.005)
        ) {
          settle();
          return;
        }
        // The reference spring is tuned at the 375 ms setting. Substeps keep it stable on late frames.
        const dt = (Math.max(0, now - previous) / durationMs) * 0.375;
        previous = now;
        const steps = Math.max(1, Math.ceil(dt * 240));
        for (let i = 0; i < steps; i++) {
          step(position, target, dt / steps, POSITION_FREQUENCY, 1);
          step(opacity, target, dt / steps, OPACITY_FREQUENCY, 1);
        }
        paint();
        frame = requestAnimationFrame(tick);
      };
      paint();
      frame = requestAnimationFrame(tick);
    } else {
      settle();
    }
    return () => {
      cancelAnimationFrame(frame);
      reserve(0);
      panel.removeAttribute("data-dock-moving");
      panel.style.transform = "";
      panel.style.opacity = "";
      releaseAnimating();
    };
  }, [getBody, edge, open, size, active, durationMs]);
}
