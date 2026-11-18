import { useLayoutEffect, useRef } from "react";
import { notifyWorkspaceLayout } from "../../lib/workspaceLayoutEvents";
import { usePanelAnimationSettings } from "../../panelAnimations";

interface Spring {
  value: number;
  velocity: number;
}

function step(spring: Spring, target: number, dt: number, frequency: number, damping: number) {
  const acceleration =
    frequency * frequency * (target - spring.value) - 2 * damping * frequency * spring.velocity;
  spring.velocity += acceleration * dt;
  spring.value += spring.velocity * dt;
}

export function useDockedPanelMotion(
  getBody: () => HTMLDivElement | null,
  edge: "left" | "right" | "bottom",
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
      reserve(Math.max(0, Math.min(1, position.value)));
      if (edge === "left") {
        panel.style.transform = `translate3d(calc(${position.value - 1} * (100% + 2 * var(--workspace-seam))), 0, 0)`;
      }
      panel.style.opacity = String(opacity.value);
      notifyWorkspaceLayout();
    };
    const settle = () => {
      position.value = opacity.value = target;
      position.velocity = opacity.velocity = 0;
      reserve(target);
      panel.removeAttribute("data-dock-moving");
      panel.style.transform = "";
      panel.style.opacity = "";
      notifyWorkspaceLayout();
    };

    if (active && (position.value !== target || position.velocity !== 0)) {
      panel.setAttribute("data-dock-moving", "");
      const start = performance.now();
      let previous = start;
      const tick = (now: number) => {
        if (now - start >= durationMs) {
          settle();
          return;
        }
        // The reference spring is tuned at the 375 ms setting. Substeps keep it stable on late frames.
        const dt = (Math.max(0, now - previous) / durationMs) * 0.375;
        previous = now;
        const steps = Math.max(1, Math.ceil(dt * 240));
        for (let i = 0; i < steps; i++) {
          step(position, target, dt / steps, (2 * Math.PI) / 0.36, 0.9);
          step(opacity, target, dt / steps, (2 * Math.PI) / 0.2, 1);
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
    };
  }, [getBody, edge, open, size, active, durationMs]);
}
