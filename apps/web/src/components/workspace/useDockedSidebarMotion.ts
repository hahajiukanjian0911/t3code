import { useLayoutEffect, useRef } from "react";
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

export function useDockedSidebarMotion(
  getBody: () => HTMLDivElement | null,
  open: boolean | null,
  width: number,
) {
  const { active, durationMs } = usePanelAnimationSettings();
  const motion = useRef<{ position: Spring; opacity: Spring } | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Synchronize the panel and its live layout before paint, retaining both spring velocities on reversal.
  useLayoutEffect(() => {
    const body = getBody();
    const sidebar = body?.querySelector<HTMLElement>(":scope > .workspace-docked-sidebar");
    if (open === null || !body || !sidebar) {
      motion.current = null;
      return;
    }

    const target = Number(open);
    const springs = (motion.current ??= {
      position: { value: target, velocity: 0 },
      opacity: { value: target, velocity: 0 },
    });
    const { position, opacity } = springs;
    let frame = 0;
    const paint = () => {
      const p = position.value;
      body.style.paddingLeft = `calc(${width * p}px + ${1 + p} * var(--workspace-seam))`;
      sidebar.style.transform = `translate3d(calc(${p - 1} * (100% + 2 * var(--workspace-seam))), 0, 0)`;
      sidebar.style.opacity = String(opacity.value);
    };
    const settle = () => {
      position.value = opacity.value = target;
      position.velocity = opacity.velocity = 0;
      body.style.paddingLeft = open ? `calc(${width}px + 2 * var(--workspace-seam))` : "";
      sidebar.style.transform = "";
      sidebar.style.opacity = "";
    };

    if (active && (position.value !== target || position.velocity !== 0)) {
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
      body.style.paddingLeft = "";
      sidebar.style.transform = "";
      sidebar.style.opacity = "";
    };
  }, [getBody, open, width, active, durationMs]);
}
