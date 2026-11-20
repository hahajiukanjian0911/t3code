export const workspacePanels = ["left", "main", "right", "floating"] as const;
export type WorkspacePanel = (typeof workspacePanels)[number];
export type WorkspaceEdge = "left" | "right" | "top" | "bottom";
export type WorkspaceMaximizeStage = "full";
export interface WorkspaceMaximizeState {
  windowId: string;
  stage: WorkspaceMaximizeStage;
}
export interface WindowPlacement {
  panel: WorkspacePanel;
  group: string;
}
interface WorkspaceRightPanelLayout {
  width?: number;
  contentShare?: number;
  hidden?: boolean;
  active?: Record<string, string>;
}
export interface WorkspaceLayout {
  placements: Record<string, WindowPlacement>;
  active: Record<string, string>;
  order: string[];
  vertical: Partial<Record<WorkspacePanel, boolean>>;
  hidden: Partial<Record<WorkspacePanel, boolean>>;
  dismissed: string[];
  sizes: { left: number; right: number; rightContentShare: number };
  chatRightPanels: Record<string, WorkspaceRightPanelLayout>;
  groupWeights: Record<string, number>;
  panelZoomedGroup: Partial<Record<WorkspacePanel, string>>;
  maximized: WorkspaceMaximizeState | null;
  floating: { x: number; y: number; width: number; height: number };
}
export const workspaceLeftMinWidth = 246;
const workspaceRightDefaultWidth = 280;
const workspaceRightContentDefaultShare = 0.5;

export function createWorkspaceLayout(): WorkspaceLayout {
  return {
    placements: {},
    active: {},
    order: [],
    vertical: {},
    hidden: {},
    dismissed: [],
    sizes: {
      left: 256,
      right: workspaceRightDefaultWidth,
      rightContentShare: workspaceRightContentDefaultShare,
    },
    chatRightPanels: {},
    groupWeights: {},
    panelZoomedGroup: {},
    maximized: null,
    floating: { x: 280, y: 140, width: 560, height: 440 },
  };
}
export function isScopedChatWorkspaceWindowId(id: string): boolean {
  return /^chat:[^:]+:.+$/.test(id);
}
export function isScopedRightWorkspaceWindowId(id: string): boolean {
  return /^(?:details|drawer):[^:]+:.+$|^surface:[^:]+:[^:]+:.+$/.test(id);
}
export function isRightWorkspaceWindowForChat(id: string, chatId: string): boolean {
  const key = chatId.slice("chat:".length);
  return id === `details:${key}` || id === `drawer:${key}` || id.startsWith(`surface:${key}:`);
}
function rightPanelSelections(layout: WorkspaceLayout) {
  return Object.entries(layout.active).filter(
    ([group, id]) => group === "right" || layout.placements[id]?.panel === "right",
  );
}
export function readWorkspaceRightPanel(layout: WorkspaceLayout) {
  return {
    width: layout.sizes.right,
    contentShare: layout.sizes.rightContentShare,
    ...(layout.hidden.right === undefined ? {} : { hidden: layout.hidden.right }),
    active: Object.fromEntries(rightPanelSelections(layout)),
  };
}
export function applyWorkspaceRightPanel(
  layout: WorkspaceLayout,
  right: WorkspaceRightPanelLayout,
): WorkspaceLayout {
  const hidden = { ...layout.hidden };
  if (right.hidden === undefined) delete hidden.right;
  else hidden.right = right.hidden;
  const active = { ...layout.active };
  for (const [group] of rightPanelSelections(layout)) delete active[group];
  return {
    ...layout,
    hidden,
    active: { ...active, ...right.active },
    sizes: {
      ...layout.sizes,
      right: right.width ?? workspaceRightDefaultWidth,
      rightContentShare: right.contentShare ?? workspaceRightContentDefaultShare,
    },
  };
}
export function restoreWorkspaceChatRightPanel(
  layout: WorkspaceLayout,
  chatId: string,
  unscopedRight: WorkspaceRightPanelLayout,
): WorkspaceLayout {
  const legacyActive = Object.fromEntries(
    Object.entries(unscopedRight.active ?? {}).filter(([, id]) =>
      isRightWorkspaceWindowForChat(id, chatId),
    ),
  );
  const legacy = legacyActive.right ? unscopedRight : {};
  const saved = layout.chatRightPanels[chatId];
  return applyWorkspaceRightPanel(layout, {
    ...legacy,
    ...saved,
    active: { ...legacyActive, ...saved?.active },
  });
}
export function rememberWorkspaceChatRightPanel(
  previous: WorkspaceLayout,
  next: WorkspaceLayout,
  chatId: string,
): WorkspaceLayout {
  const panel = { ...previous.chatRightPanels[chatId] };
  let changed = false;
  if (next.sizes.right !== previous.sizes.right) {
    panel.width = next.sizes.right;
    changed = true;
  }
  if (next.sizes.rightContentShare !== previous.sizes.rightContentShare) {
    panel.contentShare = next.sizes.rightContentShare;
    changed = true;
  }
  if (next.hidden.right !== previous.hidden.right) {
    panel.hidden = next.hidden.right === true;
    changed = true;
  }
  for (const [group, id] of rightPanelSelections(next)) {
    if (id !== previous.active[group]) {
      panel.active = { ...panel.active, [group]: id };
      changed = true;
    }
  }
  return changed
    ? { ...next, chatRightPanels: { ...next.chatRightPanels, [chatId]: panel } }
    : next;
}
export function isChatWorkspaceWindowId(id: string): boolean {
  return id === "route" || id.startsWith("chat:");
}
export function isInspectorWorkspaceWindowId(id: string): boolean {
  return id.startsWith("details:");
}
export function canMaximizeWorkspaceWindowInApp(id: string): boolean {
  return id !== "threads" && !isInspectorWorkspaceWindowId(id);
}
export function advanceWorkspaceMaximizeInApp(
  current: WorkspaceMaximizeState | null,
  windowId: string,
): WorkspaceMaximizeState | null {
  if (!canMaximizeWorkspaceWindowInApp(windowId)) return current;
  return current?.windowId === windowId ? null : { windowId, stage: "full" };
}
export function toggleWorkspaceMaximizeInPanel(
  layout: WorkspaceLayout,
  panel: WorkspacePanel,
  groupId: string,
): WorkspaceLayout {
  const current = layout.panelZoomedGroup[panel];
  const nextZoomed = { ...layout.panelZoomedGroup };
  if (current === groupId) delete nextZoomed[panel];
  else nextZoomed[panel] = groupId;
  return { ...layout, panelZoomedGroup: nextZoomed };
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
    panelZoomedGroup: edge
      ? (() => {
          const next = { ...layout.panelZoomedGroup };
          delete next[target.panel];
          return next;
        })()
      : layout.panelZoomedGroup,
    maximized: layout.maximized?.windowId === id ? null : layout.maximized,
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
      if (placement.panel === "bottom") {
        placements[id] = { panel: "right", group: "right" };
        continue;
      }
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
  const selections = (raw: unknown) =>
    Object.fromEntries(
      Object.entries(record(raw))
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .slice(-512),
    );
  const groupWeights = Object.fromEntries(
    Object.entries(record(input.groupWeights))
      .filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] > 0,
      )
      .map(([key, weight]) => [key, Math.max(0.1, Math.min(10, weight))])
      .slice(-512),
  );
  const panelZoomedGroup = Object.fromEntries(
    Object.entries(record(input.panelZoomedGroup)).filter(
      (entry): entry is [WorkspacePanel, string] =>
        workspacePanels.includes(entry[0] as WorkspacePanel) && typeof entry[1] === "string",
    ),
  );
  const rawMax = record(input.maximized);
  const maximized: WorkspaceMaximizeState | null =
    typeof rawMax.windowId === "string" &&
    canMaximizeWorkspaceWindowInApp(rawMax.windowId) &&
    rawMax.stage === "full"
      ? {
          windowId: rawMax.windowId,
          stage: "full",
        }
      : null;
  const finite = (raw: unknown, initial: number, min: number, max: number) =>
    typeof raw === "number" && Number.isFinite(raw) ? Math.max(min, Math.min(max, raw)) : initial;
  const chatRightPanels: WorkspaceLayout["chatRightPanels"] = {};
  for (const [id, raw] of Object.entries(record(input.chatRightPanels)).slice(-512)) {
    if (!isScopedChatWorkspaceWindowId(id)) continue;
    const saved = record(raw);
    const panel: WorkspaceRightPanelLayout = {};
    if (typeof saved.width === "number" && Number.isFinite(saved.width)) {
      panel.width = finite(saved.width, workspaceRightDefaultWidth, 180, 600);
    }
    if (typeof saved.contentShare === "number" && Number.isFinite(saved.contentShare)) {
      panel.contentShare = finite(
        saved.contentShare,
        workspaceRightContentDefaultShare,
        0.25,
        0.75,
      );
    }
    if (typeof saved.hidden === "boolean") panel.hidden = saved.hidden;
    if (saved.active !== undefined) panel.active = selections(saved.active);
    chatRightPanels[id] = panel;
  }
  const sizes = record(input.sizes),
    floating = record(input.floating);
  return {
    ...fallback,
    placements,
    active: selections(input.active),
    chatRightPanels,
    order: strings(input.order),
    hidden: flags(input.hidden),
    vertical: flags(input.vertical),
    dismissed: strings(input.dismissed).filter((id) => !isChatWorkspaceWindowId(id)),
    groupWeights,
    panelZoomedGroup,
    maximized,
    sizes: {
      left: finite(sizes.left, fallback.sizes.left, workspaceLeftMinWidth, 600),
      right: finite(sizes.right, fallback.sizes.right, 180, 600),
      rightContentShare: finite(
        sizes.rightContentShare,
        fallback.sizes.rightContentShare,
        0.25,
        0.75,
      ),
    },
    floating: {
      x: finite(floating.x, fallback.floating.x, 0, 10000),
      y: finite(floating.y, fallback.floating.y, 0, 10000),
      width: finite(floating.width, fallback.floating.width, 240, 3000),
      height: finite(floating.height, fallback.floating.height, 160, 2000),
    },
  };
}
