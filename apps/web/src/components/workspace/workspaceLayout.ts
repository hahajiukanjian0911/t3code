export const workspacePanels = ["left", "main", "right", "bottom", "floating"] as const;
export type WorkspacePanel = (typeof workspacePanels)[number];
export type WorkspaceEdge = "left" | "right" | "top" | "bottom";
export interface WindowPlacement {
  panel: WorkspacePanel;
  group: string;
}
export interface WorkspaceLayout {
  placements: Record<string, WindowPlacement>;
  active: Record<string, string>;
  order: string[];
  vertical: Partial<Record<WorkspacePanel, boolean>>;
  hidden: Partial<Record<WorkspacePanel, boolean>>;
  dismissed: string[];
  sizes: { left: number; right: number; bottom: number };
  floating: { x: number; y: number; width: number; height: number };
}
export function createWorkspaceLayout(): WorkspaceLayout {
  return {
    placements: {},
    active: {},
    order: [],
    vertical: {},
    hidden: {},
    dismissed: [],
    sizes: { left: 232, right: 320, bottom: 220 },
    floating: { x: 280, y: 140, width: 560, height: 440 },
  };
}
export function moveWorkspaceWindow(
  layout: WorkspaceLayout,
  id: string,
  target: WindowPlacement,
  edge?: WorkspaceEdge,
): WorkspaceLayout {
  const group = edge ? `${target.panel}:split:${id}` : target.group;
  const order = layout.order.filter((value) => value !== group);
  if (edge) {
    const targetIndex = order.indexOf(target.group);
    order.splice(
      targetIndex < 0
        ? order.length
        : targetIndex + (edge === "right" || edge === "bottom" ? 1 : 0),
      0,
      group,
    );
  } else if (!layout.order.includes(group)) {
    order.push(group);
  } else {
    order.splice(layout.order.indexOf(group), 0, group);
  }
  return {
    ...layout,
    order,
    placements: { ...layout.placements, [id]: { panel: target.panel, group } },
    active: { ...layout.active, [group]: id },
    vertical: edge
      ? { ...layout.vertical, [target.panel]: edge === "top" || edge === "bottom" }
      : layout.vertical,
    hidden: { ...layout.hidden, [target.panel]: false },
    dismissed: layout.dismissed.filter((value) => value !== id),
  };
}
export function workspaceGroups(
  layout: WorkspaceLayout,
  windows: readonly { id: string; available: boolean }[],
  panel: WorkspacePanel,
): { id: string; windows: string[]; active: string }[] {
  const groups = new Map<string, string[]>();
  for (const window of windows) {
    const placement = layout.placements[window.id];
    if (!window.available || layout.dismissed.includes(window.id) || placement?.panel !== panel)
      continue;
    const members = groups.get(placement.group) ?? [];
    members.push(window.id);
    groups.set(placement.group, members);
  }
  return Array.from(groups, ([id, members]) => ({
    id,
    windows: members,
    active: members.includes(layout.active[id] ?? "") ? layout.active[id]! : members[0]!,
  })).sort((a, b) => layout.order.indexOf(a.id) - layout.order.indexOf(b.id));
}
export function restoreWorkspaceLayout(value: unknown): WorkspaceLayout {
  const fallback = createWorkspaceLayout();
  if (typeof value !== "object" || value === null) return fallback;
  const input = value as Record<string, unknown>;
  const placements: WorkspaceLayout["placements"] = {};
  if (typeof input.placements === "object" && input.placements !== null) {
    for (const [id, raw] of Object.entries(input.placements).slice(-512)) {
      if (typeof raw !== "object" || raw === null) continue;
      const placement = raw as Record<string, unknown>;
      if (
        !workspacePanels.includes(placement.panel as WorkspacePanel) ||
        typeof placement.group !== "string"
      )
        continue;
      placements[id] = { panel: placement.panel as WorkspacePanel, group: placement.group };
    }
  }
  const record = (raw: unknown): Record<string, unknown> =>
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const strings = (raw: unknown) =>
    Array.isArray(raw)
      ? raw.filter((value): value is string => typeof value === "string").slice(-512)
      : [];
  const flags = (raw: unknown) =>
    Object.fromEntries(
      Object.entries(record(raw)).filter(
        ([key, value]) =>
          workspacePanels.includes(key as WorkspacePanel) && typeof value === "boolean",
      ),
    );
  const active = Object.fromEntries(
    Object.entries(record(input.active))
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .slice(-512),
  );
  const finite = (raw: unknown, initial: number, min: number, max: number) =>
    typeof raw === "number" && Number.isFinite(raw) ? Math.max(min, Math.min(max, raw)) : initial;
  const sizes = record(input.sizes),
    floating = record(input.floating);
  return {
    ...fallback,
    placements,
    active,
    order: strings(input.order),
    hidden: flags(input.hidden),
    vertical: flags(input.vertical),
    dismissed: strings(input.dismissed),
    sizes: {
      left: finite(sizes.left, fallback.sizes.left, 180, 600),
      right: finite(sizes.right, fallback.sizes.right, 180, 600),
      bottom: finite(sizes.bottom, fallback.sizes.bottom, 120, 600),
    },
    floating: {
      x: finite(floating.x, fallback.floating.x, 0, 10000),
      y: finite(floating.y, fallback.floating.y, 0, 10000),
      width: finite(floating.width, fallback.floating.width, 240, 3000),
      height: finite(floating.height, fallback.floating.height, 160, 2000),
    },
  };
}
