import {
  Fragment,
  createContext,
  use,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useAtomValue } from "@effect/atom-react";
import { THREAD_JUMP_KEYBINDING_COMMANDS } from "@t3tools/contracts";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { shortcutLabelForCommand } from "../../keybindings";
import { isCommandPaletteOpen } from "../../commandPaletteBus";
import { isModelPickerOpen } from "../../modelPickerVisibility";
import {
  Columns2Icon,
  EllipsisIcon,
  LayersIcon,
  Maximize2Icon,
  Minimize2Icon,
  PanelLeftIcon,
  PanelRightIcon,
  Rows2Icon,
  XIcon,
} from "lucide-react";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useStableCallback } from "../../hooks/useStableCallback";
import { isElectron } from "../../env";
import { observeResize } from "../../lib/observeResize";
import { notifyWorkspaceLayout } from "../../lib/workspaceLayoutEvents";
import { workspaceAreaProps } from "../../lib/workspaceFocus";
import { registerCommands, registerMenuAction } from "../../shortcuts/dispatcher";
import { cn } from "../../lib/utils";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { useWorkspaceResizeTransition } from "./useWorkspaceResizeTransition";
import { useDockedPanelMotion } from "./useDockedPanelMotion";
import {
  advanceWorkspaceMaximizeInApp,
  canMaximizeWorkspaceWindowInApp,
  createWorkspaceLayout,
  isChatWorkspaceWindowId,
  isInspectorWorkspaceWindowId,
  moveWorkspaceWindow,
  restoreWorkspaceLayout,
  toggleWorkspaceMaximizeInPanel,
  workspaceGroups,
  workspacePanels,
  workspaceLeftMinWidth,
  type WindowPlacement,
  type WorkspaceEdge,
  type WorkspaceLayout,
  type WorkspacePanel,
} from "./workspaceLayout";

const storageKey = "t3code:workspace-layout:v1";
interface DockWindow {
  id: string;
  defaultPanel: WorkspacePanel;
  fixed: boolean;
  closable: boolean;
  title: string;
  icon: ReactNode;
  available: boolean;
  selected: boolean;
  activation: unknown;
  container: HTMLElement;
  onActivate: () => void;
  onClose?: (() => void) | undefined;
}
interface DockSnapshot {
  windows: Record<string, DockWindow>;
  layout: WorkspaceLayout;
  focused: string | null;
}
function activateInLayout(layout: WorkspaceLayout, id: string): WorkspaceLayout {
  const placement = layout.placements[id]!;
  let maximized = layout.maximized;
  if (maximized && maximized.windowId !== id) {
    const sourcePanel = layout.placements[maximized.windowId]?.panel;
    if (canMaximizeWorkspaceWindowInApp(id) && placement.panel === sourcePanel) {
      maximized = { windowId: id, stage: "full" };
    } else {
      maximized = null;
    }
  }
  return {
    ...layout,
    maximized,
    active: { ...layout.active, [placement.group]: id },
    hidden: { ...layout.hidden, [placement.panel]: false },
    dismissed: layout.dismissed.filter((value) => value !== id),
  };
}
function orderedRightPanelTabIds(
  groups: ReadonlyArray<{ readonly windows: readonly string[] }>,
): string[] {
  const ids = groups.flatMap((group) => group.windows);
  return [
    ...ids.filter((id) => isInspectorWorkspaceWindowId(id)),
    ...ids.filter((id) => !isInspectorWorkspaceWindowId(id)),
  ];
}

function createDockStore(
  captureResize: ReturnType<typeof useWorkspaceResizeTransition>["capture"],
) {
  let layout = createWorkspaceLayout();
  try {
    layout = restoreWorkspaceLayout(JSON.parse(localStorage.getItem(storageKey) ?? "null"));
  } catch {
    /* Storage is optional. */
  }
  let snapshot: DockSnapshot = { windows: {}, layout, focused: null };
  let revealOnRegistration: string | null = null;
  const listeners = new Set<() => void>();
  let body: HTMLDivElement | null = null;
  let parking: HTMLDivElement | null = null;
  let openers: Partial<Record<WorkspacePanel, () => void>> = {};
  const actionContainers = new Map<string, HTMLDivElement>();
  const getActionsContainer = (id: string) => {
    let node = actionContainers.get(id);
    if (!node) {
      node = document.createElement("div");
      node.className = "flex items-center";
      actionContainers.set(id, node);
    }
    return node;
  };
  const park = (id: string) => {
    const container = snapshot.windows[id]?.container;
    if (container && parking) moveContainer(parking, container);
  };
  const publish = (next: DockSnapshot, save = false) => {
    if (snapshot.layout !== next.layout || snapshot.windows !== next.windows) {
      const before = dockView(snapshot),
        after = dockView(next);
      if (body && before.fullPanel !== after.fullPanel) {
        captureResize(body, [before.fullPanel, after.fullPanel]);
      }
      if (
        body &&
        !after.full &&
        (before.panelOpen("right") !== after.panelOpen("right") ||
          (after.panelVisible("right") && before.rightContentMode !== after.rightContentMode))
      ) {
        captureResize(body, ["main", "right"]);
      }
      for (const id of Object.keys(snapshot.windows)) {
        const previous = before.layout.placements[id],
          placement = after.layout.placements[id];
        if (previous?.panel !== placement?.panel || previous?.group !== placement?.group) park(id);
      }
    }
    snapshot = next;
    if (save) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(next.layout));
      } catch {
        /* Storage is optional. */
      }
    }
    for (const listener of listeners) listener();
  };
  const publishLayout = (next: WorkspaceLayout, save = true) => {
    for (const window of Object.values(snapshot.windows)) {
      const placement = next.placements[window.id];
      if (
        window.fixed &&
        (placement?.panel !== window.defaultPanel || placement.group !== window.defaultPanel)
      )
        next = moveWorkspaceWindow(next, window.id, {
          panel: window.defaultPanel,
          group: window.defaultPanel,
        });
    }
    publish({ ...snapshot, layout: next }, save);
  };
  const updateLayout = publishLayout;
  const resolveTargetWindowId = (explicitId?: string): string | null => {
    if (explicitId && snapshot.windows[explicitId]?.available) return explicitId;
    if (typeof document !== "undefined") {
      const activeWin = document.activeElement?.closest<HTMLElement>("[data-workspace-window]");
      const domId = activeWin?.dataset.workspaceWindow;
      if (domId && snapshot.windows[domId]?.available) return domId;
    }
    if (snapshot.focused && snapshot.windows[snapshot.focused]?.available) return snapshot.focused;
    const chatWin = Object.values(snapshot.windows).find(
      (win) => win.available && win.id.startsWith("chat:"),
    );
    if (chatWin) return chatWin.id;
    return snapshot.windows.route?.available ? "route" : null;
  };
  const focusMainWindowElement = (
    container: HTMLElement,
    allowToggleWithinMain: boolean,
  ): boolean => {
    const composerArea = container.querySelector<HTMLElement>('[data-workspace-area="composer"]');
    const composerEditor =
      container.querySelector<HTMLElement>(
        '[data-workspace-area="composer"] [data-testid="composer-editor"]',
      ) ??
      container.querySelector<HTMLElement>(
        '[data-workspace-area="composer"] [contenteditable="true"]',
      ) ??
      container.querySelector<HTMLElement>(
        '[data-testid="composer-editor"], textarea:not(:disabled), input:not(:disabled)',
      );
    const conversationTarget =
      container.querySelector<HTMLElement>(
        '[data-workspace-area="conversation"] [data-workspace-focus-default]',
      ) ??
      container.querySelector<HTMLElement>(
        '[data-workspace-area="conversation"] .messages-timeline-scroll',
      ) ??
      container.querySelector<HTMLElement>('[data-workspace-area="conversation"]');
    const active = document.activeElement;
    if (allowToggleWithinMain && active instanceof HTMLElement && container.contains(active)) {
      const inComposer =
        Boolean(composerArea?.contains(active)) || Boolean(composerEditor?.contains(active));
      const next = inComposer
        ? (conversationTarget ?? composerEditor)
        : (composerEditor ?? conversationTarget);
      if (next) {
        next.focus({ preventScroll: true });
        return true;
      }
      return false;
    }
    const preferred =
      composerEditor ??
      conversationTarget ??
      container.querySelector<HTMLElement>("[data-workspace-window]");
    if (!preferred) return false;
    preferred.focus({ preventScroll: true });
    return document.activeElement === preferred || container.contains(document.activeElement);
  };
  const focusWindowContainerNow = (id: string, composer = false): boolean => {
    if (typeof document === "undefined") return false;
    const container = snapshot.windows[id]?.container;
    if (!container || !container.isConnected || !visibleWindow(snapshot, id)) return false;
    if (composer) {
      return focusMainWindowElement(container, false);
    }
    if (container.contains(document.activeElement)) return true;
    const preferred =
      container.querySelector<HTMLElement>(
        '[data-workspace-focus-default], .xterm-helper-textarea, [contenteditable="true"], textarea:not(:disabled), input:not(:disabled)',
      ) ??
      container.querySelector<HTMLElement>(
        "button:not(:disabled):not([data-workspace-grab]):not([data-workspace-window-controls] *)",
      ) ??
      container.querySelector<HTMLElement>("[data-workspace-window]");
    if (!preferred) return false;
    preferred.focus({ preventScroll: true });
    return document.activeElement === preferred || container.contains(document.activeElement);
  };
  const focusWindowContainer = (id: string, composer = false) => {
    if (typeof document === "undefined" || typeof requestAnimationFrame === "undefined") return;
    requestAnimationFrame(() => {
      focusWindowContainerNow(id, composer);
    });
  };
  const isPanelFocused = (panel: WorkspacePanel, activeWindowId?: string): boolean => {
    if (typeof document === "undefined") return false;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return false;
    if (activeWindowId && snapshot.windows[activeWindowId]?.container.contains(active)) {
      return true;
    }
    const panelEl = body?.querySelector<HTMLElement>(`[data-workspace-panel="${panel}"]`);
    return Boolean(panelEl?.contains(active));
  };
  const activate = (id: string, layout = snapshot.layout) => {
    const placement = layout.placements[id];
    if (!placement) return;
    const window = snapshot.windows[id];
    const nextLayout = activateInLayout(layout, id);
    publish({ ...snapshot, focused: id, layout: nextLayout }, true);
    window?.onActivate();
  };
  return {
    getSnapshot: () => snapshot,
    getBody: () => body,
    setBody: (node: HTMLDivElement | null) => {
      body = node;
    },
    setParking: (node: HTMLDivElement | null) => {
      parking = node;
    },
    getActionsContainer,
    setOpeners: (next: typeof openers) => {
      openers = next;
    },
    togglePanel(panel: WorkspacePanel) {
      const view = dockView(snapshot);
      const members = view.groups[panel];
      const sourcePanel = view.max && snapshot.layout.placements[view.max.windowId]?.panel;
      const keepStage = panel === "floating" && !view.maximizedFloating;
      if (members.length > 0 || sourcePanel === panel) {
        const wasFullOnPanel = Boolean(view.full && sourcePanel === panel);
        updateLayout({
          ...snapshot.layout,
          maximized: keepStage ? snapshot.layout.maximized : null,
          hidden: {
            ...snapshot.layout.hidden,
            [panel]: wasFullOnPanel ? true : view.panelVisible(panel),
          },
        });
        return;
      }
      const window = Object.values(snapshot.windows).find(
        (value) => value.available && value.defaultPanel === panel && value.id !== "route",
      );
      if (window) {
        updateLayout({
          ...moveWorkspaceWindow(snapshot.layout, window.id, { panel, group: panel }),
          maximized: keepStage ? snapshot.layout.maximized : null,
        });
        activate(window.id);
      } else openers[panel]?.();
    },
    focusOrTogglePanel(panel: WorkspacePanel): "focused" | "closed" | "opened" {
      const view = dockView(snapshot);
      const sourcePanel = view.max && snapshot.layout.placements[view.max.windowId]?.panel;
      const isFullOnPanel = Boolean(view.full && sourcePanel === panel);
      const visible = view.panelVisible(panel) || isFullOnPanel;
      const activeId = isFullOnPanel ? view.full!.windowId : view.groups[panel][0]?.active;
      const panelWindows = view.groups[panel].flatMap((group) => group.windows);
      const onlyInspectorWindow =
        panel === "right" &&
        !isFullOnPanel &&
        panelWindows.length === 1 &&
        isInspectorWorkspaceWindowId(panelWindows[0]!);
      if (visible && activeId) {
        if (isPanelFocused(panel, activeId) || onlyInspectorWindow) {
          const keepStage = panel === "floating" && !view.maximizedFloating;
          updateLayout({
            ...snapshot.layout,
            maximized: keepStage ? snapshot.layout.maximized : null,
            hidden: {
              ...snapshot.layout.hidden,
              [panel]: true,
            },
          });
          if (isPanelFocused(panel, activeId)) {
            const mainId =
              Object.values(snapshot.windows).find(
                (win) => win.available && win.id.startsWith("chat:"),
              )?.id ?? view.groups.main[0]?.active;
            if (mainId) focusWindowContainer(mainId, true);
          }
          return "closed";
        }
        activate(activeId);
        if (!focusWindowContainerNow(activeId)) focusWindowContainer(activeId);
        return "focused";
      }
      const members = view.groups[panel];
      const keepStage = panel === "floating" && !view.maximizedFloating;
      if (members.length > 0 || sourcePanel === panel) {
        updateLayout({
          ...snapshot.layout,
          maximized: keepStage ? snapshot.layout.maximized : null,
          hidden: {
            ...snapshot.layout.hidden,
            [panel]: false,
          },
        });
        const targetId =
          members[0]?.active ?? (sourcePanel === panel ? view.max?.windowId : undefined);
        if (targetId) {
          activate(targetId);
          if (!onlyInspectorWindow) focusWindowContainer(targetId);
        }
        return "opened";
      }
      const fallbackWindow = Object.values(snapshot.windows).find(
        (value) => value.available && value.defaultPanel === panel && value.id !== "route",
      );
      if (fallbackWindow) {
        updateLayout({
          ...moveWorkspaceWindow(snapshot.layout, fallbackWindow.id, { panel, group: panel }),
          maximized: keepStage ? snapshot.layout.maximized : null,
        });
        activate(fallbackWindow.id);
        focusWindowContainer(fallbackWindow.id);
        return "opened";
      }
      openers[panel]?.();
      return "opened";
    },
    hidePanel(panel: WorkspacePanel) {
      if (snapshot.layout.hidden[panel]) return;
      updateLayout({
        ...snapshot.layout,
        hidden: { ...snapshot.layout.hidden, [panel]: true },
      });
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    revealWindow(id: string) {
      if (!snapshot.windows[id]?.available) {
        revealOnRegistration = id;
        return;
      }
      revealOnRegistration = null;
      if (!visibleWindow(snapshot, id)) publishLayout(activateInLayout(snapshot.layout, id));
    },
    register(window: DockWindow, panel: WorkspacePanel) {
      const previous = snapshot.windows[window.id];
      const restored = !previous && snapshot.layout.placements[window.id] !== undefined;
      let next = snapshot.layout;
      const placement = next.placements[window.id];
      if (
        !placement ||
        (window.fixed && (placement.panel !== panel || placement.group !== panel))
      ) {
        const currentActive = next.active[panel];
        next = moveWorkspaceWindow(next, window.id, { panel, group: panel });
        if (!window.selected) {
          next = {
            ...next,
            hidden: snapshot.layout.hidden,
            active: currentActive ? { ...next.active, [panel]: currentActive } : next.active,
          };
        }
      }
      const selected = window.available && window.selected;
      const requested = selected && revealOnRegistration === window.id;
      if (
        requested ||
        (selected &&
          !restored &&
          (!previous?.selected || previous.activation !== window.activation))
      ) {
        if (requested) revealOnRegistration = null;
        next = activateInLayout(next, window.id);
      }
      publish(
        { ...snapshot, windows: { ...snapshot.windows, [window.id]: window }, layout: next },
        requested,
      );
    },
    unregister(id: string) {
      actionContainers.delete(id);
      const { [id]: _removed, ...windows } = snapshot.windows;
      publish({ ...snapshot, windows });
    },
    activate,
    activateRightPanelTabByIndex(index: number): boolean {
      if (isCommandPaletteOpen() || isModelPickerOpen()) return false;
      const view = dockView(snapshot);
      const isFullOnRight = Boolean(view.full && view.fullPanel === "right");
      const visible = view.panelVisible("right") || isFullOnRight;
      if (!visible) return false;
      const activeId = isFullOnRight ? view.full!.windowId : view.groups.right[0]?.active;
      if (!isPanelFocused("right", activeId)) return false;
      const orderedIds = orderedRightPanelTabIds(view.groups.right);
      if (orderedIds.length < 2) return false;
      const targetId = orderedIds[index];
      if (!targetId) return true;
      activate(targetId);
      if (!focusWindowContainerNow(targetId)) focusWindowContainer(targetId);
      return true;
    },
    toggleWindow(id: string, panel?: WorkspacePanel) {
      const window = snapshot.windows[id];
      const placement = snapshot.layout.placements[id];
      if (panel && placement && (!window?.available || placement.panel !== panel)) {
        updateLayout(moveWorkspaceWindow(snapshot.layout, id, { panel, group: panel }));
        if (!window?.available) return false;
        activate(id);
        return true;
      }
      if (!snapshot.windows[id]?.available) return false;
      if (visibleWindow(snapshot, id)) {
        if (window && !window.closable) return true;
        updateLayout({ ...snapshot.layout, dismissed: [...snapshot.layout.dismissed, id] });
      } else activate(id);
      return true;
    },
    focusOrToggleWindow(id: string, panel?: WorkspacePanel): "focused" | "closed" | false {
      const window = snapshot.windows[id];
      const placement = snapshot.layout.placements[id];
      if (panel && placement && (!window?.available || placement.panel !== panel)) {
        updateLayout(moveWorkspaceWindow(snapshot.layout, id, { panel, group: panel }));
        if (!window?.available) return false;
        activate(id);
        focusWindowContainer(id);
        return "focused";
      }
      if (!window?.available) return false;
      if (visibleWindow(snapshot, id)) {
        const active = typeof document !== "undefined" ? document.activeElement : null;
        const focusedInWindow =
          active instanceof HTMLElement &&
          (window.container.contains(active) ||
            (placement !== undefined && isPanelFocused(placement.panel, id)));
        if (!focusedInWindow) {
          activate(id);
          if (!focusWindowContainerNow(id)) focusWindowContainer(id);
          return "focused";
        }
        if (!window.closable) return "focused";
        updateLayout({ ...snapshot.layout, dismissed: [...snapshot.layout.dismissed, id] });
        const mainId =
          Object.values(snapshot.windows).find((win) => win.available && win.id.startsWith("chat:"))
            ?.id ?? dockView(snapshot).groups.main[0]?.active;
        if (mainId) focusWindowContainer(mainId, true);
        return "closed";
      }
      activate(id);
      focusWindowContainer(id);
      return "focused";
    },
    close(id: string) {
      const window = snapshot.windows[id];
      if (window?.fixed || window?.closable === false) return;
      if (snapshot.layout.maximized?.windowId === id) {
        updateLayout({ ...snapshot.layout, maximized: null });
      }
      if (window?.onClose) window.onClose();
      else
        updateLayout({
          ...snapshot.layout,
          maximized: snapshot.layout.maximized?.windowId === id ? null : snapshot.layout.maximized,
          dismissed: [...snapshot.layout.dismissed, id],
        });
    },
    move(id: string, target: WindowPlacement, edge?: WorkspaceEdge) {
      if (snapshot.windows[id]?.fixed) return;
      updateLayout(moveWorkspaceWindow(snapshot.layout, id, target, edge));
      activate(id);
    },
    toggleMaximizeInApp(explicitId?: string) {
      const targetId = resolveTargetWindowId(explicitId);
      if (!targetId) return false;
      const canMaximize = canMaximizeWorkspaceWindowInApp(targetId);
      if (!canMaximize && !snapshot.layout.maximized) return false;
      const maximized = canMaximize
        ? advanceWorkspaceMaximizeInApp(snapshot.layout.maximized, targetId)
        : null;
      const next = { ...snapshot.layout, maximized };
      if (canMaximize) {
        activate(targetId, next);
        focusWindowContainer(targetId);
      } else updateLayout(next);
      return true;
    },
    exitMaximizeInApp() {
      if (!snapshot.layout.maximized) return false;
      updateLayout({ ...snapshot.layout, maximized: null });
      return true;
    },
    toggleMaximizeInPanel(explicitId?: string) {
      const targetId = resolveTargetWindowId(explicitId);
      if (!targetId) return false;
      const placement = snapshot.layout.placements[targetId];
      if (!placement || placement.panel === "floating") return false;
      const groupsInPanel = workspaceGroups(
        snapshot.layout,
        Object.values(snapshot.windows),
        placement.panel,
      );
      if (groupsInPanel.length < 2 && !snapshot.layout.panelZoomedGroup[placement.panel]) {
        return false;
      }
      updateLayout(
        toggleWorkspaceMaximizeInPanel(snapshot.layout, placement.panel, placement.group),
      );
      activate(targetId);
      focusWindowContainer(targetId);
      return true;
    },
    focusPanel(panel: WorkspacePanel) {
      const windows = Object.values(snapshot.windows);
      const view = dockView(snapshot);
      const target =
        panel === "main"
          ? windows.find((win) => win.available && win.id.startsWith("chat:"))?.id
          : undefined;
      const id = target ?? view.groups[panel][0]?.active;
      if (!id) {
        const open = openers[panel];
        if (!open) return false;
        open();
        return true;
      }
      const wasVisible = visibleWindow(snapshot, id);
      if (!wasVisible)
        updateLayout({
          ...snapshot.layout,
          maximized: null,
          panelZoomedGroup: { ...snapshot.layout.panelZoomedGroup, [panel]: undefined },
        });
      activate(id);
      if (panel === "main") {
        const container = snapshot.windows[id]?.container;
        if (wasVisible && container?.isConnected) {
          focusMainWindowElement(container, true);
        } else {
          focusWindowContainer(id, true);
        }
        return true;
      }
      if (!focusWindowContainerNow(id)) focusWindowContainer(id);
      return true;
    },
    moveFocused(panel: WorkspacePanel) {
      const id = resolveTargetWindowId();
      if (!id || snapshot.windows[id]?.fixed || isChatWorkspaceWindowId(id)) return false;
      const group =
        workspaceGroups(snapshot.layout, Object.values(snapshot.windows), panel)[0]?.id ?? panel;
      updateLayout(moveWorkspaceWindow(snapshot.layout, id, { panel, group }));
      activate(id);
      focusWindowContainer(id);
      return true;
    },
    splitFocused(edge: "right" | "bottom", explicitId?: string) {
      const targetId = resolveTargetWindowId(explicitId);
      if (!targetId || snapshot.windows[targetId]?.fixed) return false;
      const placement = snapshot.layout.placements[targetId];
      if (!placement || placement.panel === "floating") return false;
      updateLayout(moveWorkspaceWindow(snapshot.layout, targetId, placement, edge));
      activate(targetId);
      focusWindowContainer(targetId);
      return true;
    },
    focusDirection(direction: "left" | "right" | "up" | "down") {
      if (typeof document === "undefined") return false;
      const currentId = resolveTargetWindowId();
      const max = snapshot.layout.maximized;
      if (max) {
        const chatWin =
          Object.values(snapshot.windows).find((w) => w.available && w.id.startsWith("chat:")) ??
          (snapshot.windows.route?.available ? snapshot.windows.route : undefined);
        if (isChatWorkspaceWindowId(max.windowId)) {
          if (direction === "left" && snapshot.windows.threads?.available) {
            updateLayout({
              ...snapshot.layout,
              maximized: null,
              hidden: { ...snapshot.layout.hidden, left: false },
            });
            activate("threads");
            focusWindowContainer("threads");
            return true;
          }
          if (direction === "right") {
            const rightGroup = workspaceGroups(
              snapshot.layout,
              Object.values(snapshot.windows),
              "right",
            )[0];
            if (rightGroup) {
              updateLayout({
                ...snapshot.layout,
                maximized: null,
                hidden: { ...snapshot.layout.hidden, right: false },
              });
              activate(rightGroup.active);
              focusWindowContainer(rightGroup.active);
              return true;
            }
          }
        } else if (direction === "left") {
          updateLayout({
            ...snapshot.layout,
            maximized: null,
          });
          if (chatWin) {
            activate(chatWin.id);
            focusWindowContainer(chatWin.id);
          }
          return true;
        }
      }

      const candidates = Object.values(snapshot.windows)
        .filter((win) => win.id !== currentId && visibleWindow(snapshot, win.id))
        .map((win) => ({ id: win.id, rect: win.container.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 4 && rect.height > 4);
      if (candidates.length === 0) return false;

      const currentRect = currentId
        ? snapshot.windows[currentId]?.container.getBoundingClientRect()
        : null;
      if (!currentRect || currentRect.width <= 0) {
        const first = candidates[0]!;
        activate(first.id);
        focusWindowContainer(first.id);
        return true;
      }
      const cx = currentRect.left + currentRect.width / 2;
      const cy = currentRect.top + currentRect.height / 2;
      let best: { id: string; score: number } | null = null;
      for (const candidate of candidates) {
        const tx = candidate.rect.left + candidate.rect.width / 2;
        const ty = candidate.rect.top + candidate.rect.height / 2;
        const dx = tx - cx;
        const dy = ty - cy;
        const inDir =
          direction === "left"
            ? dx < -8
            : direction === "right"
              ? dx > 8
              : direction === "up"
                ? dy < -8
                : dy > 8;
        if (!inDir) continue;
        const primary = direction === "left" || direction === "right" ? Math.abs(dx) : Math.abs(dy);
        const cross = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
        const score = primary + cross * 2.2;
        if (!best || score < best.score) best = { id: candidate.id, score };
      }
      if (!best) return false;
      activate(best.id);
      focusWindowContainer(best.id);
      return true;
    },
    updateLayout,
  };
}
type DockStore = ReturnType<typeof createDockStore>;
const DockContext = createContext<DockStore | null>(null);
const WindowContext = createContext<string | null>(null);
function activeMaximizedState(snapshot: DockSnapshot) {
  const max = snapshot.layout.maximized;
  if (!max) return null;
  const target = snapshot.windows[max.windowId];
  const placement = snapshot.layout.placements[max.windowId];
  if (
    !target?.available ||
    snapshot.layout.dismissed.includes(max.windowId) ||
    !placement ||
    !canMaximizeWorkspaceWindowInApp(max.windowId)
  ) {
    return null;
  }
  return max;
}
function resolveDockView(snapshot: DockSnapshot) {
  const registered = Object.values(snapshot.windows);
  const chat = registered.find((window) => window.available && window.id.startsWith("chat:"));
  const shown = registered.filter((window) => window.id !== "route" || !chat);
  const max = activeMaximizedState(snapshot);
  const full = max;
  const maximizedFloating = !!max && snapshot.layout.placements[max.windowId]?.panel === "floating";
  const layout = snapshot.layout;
  const groups = Object.fromEntries(
    workspacePanels.map((panel) => [panel, workspaceGroups(layout, shown, panel)]),
  ) as Record<WorkspacePanel, ReturnType<typeof workspaceGroups>>;
  const fullPanel = full ? layout.placements[full.windowId]!.panel : null;
  const panelOpen = (panel: WorkspacePanel) =>
    !layout.hidden[panel] && (panel === "main" || groups[panel].length > 0);
  const panelVisible = (panel: WorkspacePanel) =>
    panelOpen(panel) && (panel === "floating" ? !maximizedFloating : !full);
  const rightContentMode = groups.right.some(
    (group) => !isInspectorWorkspaceWindowId(group.active),
  );
  return {
    layout,
    max,
    full,
    groups,
    fullPanel,
    panelOpen,
    rightContentMode,
    panelVisible,
    maximizedFloating,
    chatPresent: !!chat,
  };
}
const dockViews = new WeakMap<DockSnapshot, ReturnType<typeof resolveDockView>>();
function dockView(snapshot: DockSnapshot) {
  let view = dockViews.get(snapshot);
  if (!view) {
    view = resolveDockView(snapshot);
    dockViews.set(snapshot, view);
  }
  return view;
}
function visibleWindow(snapshot: DockSnapshot, id: string): boolean {
  const { layout, groups, panelVisible, chatPresent, full } = dockView(snapshot);
  const placement = layout.placements[id];
  if (!snapshot.windows[id]?.available || !placement || (id === "route" && chatPresent))
    return false;
  if (full?.windowId === id) return true;
  if (!panelVisible(placement.panel)) return false;
  const panelGroups = groups[placement.panel];
  const zoomed = layout.panelZoomedGroup[placement.panel];
  const activeGroups =
    zoomed && panelGroups.some((group) => group.id === zoomed)
      ? panelGroups.filter((group) => group.id === zoomed)
      : panelGroups;
  return activeGroups.some((group) => group.active === id);
}
export function useWorkspaceDockEnabled(): boolean {
  return use(DockContext) !== null;
}
export function useWorkspaceWindowVisible(windowId?: string): boolean | undefined {
  const store = use(DockContext);
  const contextId = use(WindowContext);
  const id = windowId ?? contextId;
  return useSyncExternalStore(store?.subscribe ?? subscribeNothing, () =>
    store && id ? visibleWindow(store.getSnapshot(), id) : undefined,
  );
}
function subscribeNothing() {
  return () => undefined;
}

export function WorkspaceWindow(props: {
  id: string;
  title: string;
  icon?: ReactNode;
  panel: WorkspacePanel;
  children: ReactNode;
  enabled?: boolean;
  available?: boolean;
  selected?: boolean;
  fixed?: boolean;
  closable?: boolean;
  activation?: unknown;
  onActivate?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
}) {
  const store = use(DockContext);
  if (!store || props.enabled === false) return props.children;
  return <RegisteredWindow {...props} store={store} />;
}
function RegisteredWindow({
  store,
  ...props
}: Parameters<typeof WorkspaceWindow>[0] & { store: DockStore }) {
  const [container] = useState(() => {
    const node = document.createElement("div");
    node.dataset.workspaceWindowContainer = "";
    node.className =
      "relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden data-[workspace-dragging]:rounded-[7px] data-[workspace-dragging]:border data-[workspace-dragging]:border-border data-[workspace-dragging]:bg-popover";
    return node;
  });
  const canClose = props.onClose !== undefined;
  const activate = useStableCallback(() => props.onActivate?.());
  const close = useStableCallback(() => props.onClose?.());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes a portal container to the external docking layout
  useLayoutEffect(() => {
    store.register(
      {
        id: props.id,
        defaultPanel: props.panel,
        fixed: props.fixed ?? false,
        closable: props.closable ?? true,
        title: props.title,
        icon: props.icon,
        container,
        available: props.available ?? true,
        selected: props.selected ?? false,
        activation: props.activation,
        onActivate: activate,
        onClose: canClose ? close : undefined,
      },
      props.panel,
    );
  }, [
    store,
    props.id,
    props.title,
    props.icon,
    props.available,
    props.selected,
    props.fixed,
    props.closable,
    props.activation,
    props.panel,
    canClose,
    container,
    activate,
    close,
  ]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- unregisters the external window when its owning route or resource unmounts
  useLayoutEffect(() => () => store.unregister(props.id), [store, props.id]);
  return createPortal(
    <WindowContext value={props.id}>
      <WindowContents store={store} id={props.id} title={props.title} fixed={props.fixed ?? false}>
        {props.children}
      </WindowContents>
    </WindowContext>,
    container,
  );
}
function WindowContents({
  fixed,
  store,
  id,
  title,
  children,
}: {
  store: DockStore;
  id: string;
  title: string;
  fixed: boolean;
  children: ReactNode;
}) {
  const visible = useSyncExternalStore(store.subscribe, () =>
    visibleWindow(store.getSnapshot(), id),
  );
  const dockMenuHoistedToHeading = useSyncExternalStore(store.subscribe, () => {
    const snap = store.getSnapshot();
    const placement = snap.layout.placements[id];
    if (placement?.panel !== "right") return false;
    if (snap.layout.maximized?.windowId === id && isChatWorkspaceWindowId(id)) return false;
    return workspaceGroups(snap.layout, Object.values(snap.windows), "right").length <= 1;
  });
  const [visited, setVisited] = useState(false);
  if (visible && !visited) setVisited(true);
  const activate = () => {
    if ((id !== "route" || visible) && store.getSnapshot().focused !== id) store.activate(id);
  };
  return visible || visited || id === "route" ? (
    <div
      className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col"
      data-workspace-window={id}
      tabIndex={-1}
      {...(id.startsWith("surface:")
        ? workspaceAreaProps("panel", 4, title)
        : id.startsWith("drawer:")
          ? workspaceAreaProps("terminal", 5, title)
          : {})}
      onFocusCapture={activate}
      onPointerDownCapture={activate}
    >
      {fixed || (id === "route" && !visible) ? null : (
        <>
          <WindowGrab store={store} id={id} title={title} />
          <div
            role="toolbar"
            aria-label={title}
            className="absolute top-1 right-1 z-30 flex items-center gap-1 rounded-md bg-background/95 opacity-0 hover:opacity-100 focus-within:opacity-100 [&:has([data-popup-open])]:opacity-100 [-webkit-app-region:no-drag]"
            data-workspace-window-controls=""
          >
            <PortalMount node={store.getActionsContainer(id)} className="flex items-center" />
            {dockMenuHoistedToHeading ? null : <DockMenu store={store} id={id} />}
          </div>
        </>
      )}
      {children}
    </div>
  ) : null;
}
function PortalMount({
  node,
  className,
  hidden = false,
}: {
  node: HTMLElement;
  className?: string;
  hidden?: boolean;
}) {
  const attach = (parent: HTMLDivElement | null) => {
    if (!parent || node.parentElement === parent) return;
    // A stable, state-preserving portal container keeps editors, iframes and terminals alive on moves.
    moveContainer(parent, node);
  };
  return <div ref={attach} hidden={hidden} inert={hidden} className={className} />;
}

function moveContainer(parent: HTMLElement, node: HTMLElement) {
  if (node.isConnected && parent.isConnected && "moveBefore" in parent)
    parent.moveBefore(node, null);
  else parent.append(node);
}
export function WorkspacePanelActions({ children }: { children: ReactNode }) {
  const store = use(DockContext);
  return store ? createPortal(children, store.getActionsContainer("panel:right")) : children;
}

export function WorkspaceActions({
  windowId,
  children,
  onOpenRight,
}: {
  windowId: string;
  children?: ReactNode;
  onOpenRight: () => void;
}) {
  const store = use(DockContext);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- connects global panel controls to the active thread's existing resource commands
  useLayoutEffect(() => {
    store?.setOpeners({ right: onOpenRight });
    return () => store?.setOpeners({});
  }, [store, onOpenRight]);
  return store && children
    ? createPortal(
        <div className="flex items-center">{children}</div>,
        store.getActionsContainer(windowId),
      )
    : null;
}
export function useWorkspaceWindowToggle() {
  const store = use(DockContext);
  return (id: string, panel?: WorkspacePanel) => store?.toggleWindow(id, panel) ?? false;
}
export function useWorkspacePanel(panel: WorkspacePanel) {
  const store = use(DockContext);
  const visible = useSyncExternalStore(store?.subscribe ?? subscribeNothing, () => {
    if (!store) return false;
    return dockView(store.getSnapshot()).panelVisible(panel);
  });
  return store
    ? {
        visible,
        revealWindow: store.revealWindow,
        toggle: () => store.togglePanel(panel),
        focusOrToggle: (windowId?: string) =>
          windowId && store.getSnapshot().layout.placements[windowId]?.panel !== panel
            ? store.focusOrToggleWindow(windowId)
            : store.focusOrTogglePanel(panel),
      }
    : null;
}
export function WorkspaceRoot({
  children,
  controls,
}: {
  children: ReactNode;
  controls?: ReactNode;
}) {
  const wide = useMediaQuery("(min-width: 768px)");
  const { capture, play } = useWorkspaceResizeTransition();
  const [store] = useState(() => createDockStore(capture));
  if (!wide && !isElectron)
    return (
      <>
        {controls}
        {children}
      </>
    );
  return (
    <DockContext value={store}>
      <DockFrame store={store} controls={controls} playResize={play}>
        {children}
      </DockFrame>
    </DockContext>
  );
}
function workspacePanelLabel(): Record<WorkspacePanel, string> {
  return {
    left: "Left panel",
    main: "Main panel",
    right: "Right panel",
    floating: "Floating panel",
  };
}
function useLastDockWindow(active: string | undefined) {
  const [last, setLast] = useState(active);
  if (active !== undefined && active !== last) setLast(active);
  return active ?? last;
}

function DockFrame({
  store,
  playResize,
  children,
  controls,
}: {
  store: DockStore;
  playResize: ReturnType<typeof useWorkspaceResizeTransition>["play"];
  children: ReactNode;
  controls?: ReactNode;
}) {
  const panelLabels = workspacePanelLabel();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const {
    layout,
    max: activeMax,
    full,
    groups,
    fullPanel,
    panelOpen,
    rightContentMode,
    panelVisible,
    maximizedFloating,
    chatPresent,
  } = dockView(snapshot);
  const [dockWidth, setDockWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1280,
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tracks the outer dock width so content tabs in the right panel split remaining space dynamically
  useLayoutEffect(() => {
    const node = store.getBody()?.parentElement;
    if (!node) return;
    return observeResize(node, (entries) => {
      const next = entries[0]?.contentRect.width;
      if (next !== undefined && next > 0) setDockWidth(next);
    });
  }, [store]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers global workspace window commands while the dock frame is mounted
  useEffect(() => {
    const consume = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const actions = {
      "workspace.toggleMaximizeInApp": () => store.toggleMaximizeInApp(),
      "workspace.toggleMaximizeInPanel": () => store.toggleMaximizeInPanel(),
      "workspace.splitRight": () => store.splitFocused("right"),
      "workspace.splitDown": () => store.splitFocused("bottom"),
      "floatingPanel.toggle": () => store.togglePanel("floating"),
      "workspace.focusLeft": () => store.focusDirection("left"),
      "workspace.focusRight": () => store.focusDirection("right"),
      "workspace.focusUp": () => store.focusDirection("up"),
      "workspace.focusDown": () => store.focusDirection("down"),
      "workspace.focusPanel.left": () => store.focusPanel("left"),
      "workspace.focusPanel.main": () => store.focusPanel("main"),
      "workspace.focusPanel.right": () => store.focusPanel("right"),
      "workspace.moveLeft": () => store.moveFocused("left"),
      "workspace.moveRight": () => store.moveFocused("right"),
      "workspace.moveFloat": () => store.moveFocused("floating"),
    };
    const jumpActions = Object.fromEntries(
      THREAD_JUMP_KEYBINDING_COMMANDS.map((command, index) => [
        command,
        (event: KeyboardEvent) => {
          if (event.repeat || store.activateRightPanelTabByIndex(index) === false) return false;
          consume(event);
        },
      ]),
    );
    const disposers = [
      registerCommands(
        {
          ...Object.fromEntries(
            Object.entries(actions).map(([command, run]) => [
              command,
              (event: KeyboardEvent) => {
                if ((event.repeat && !command.startsWith("workspace.focus")) || run() === false)
                  return false;
                consume(event);
              },
            ]),
          ),
          ...jumpActions,
        },
        {
          capture: true,
          keybindings: () => keybindings,
          when: (event) =>
            !(
              event.target instanceof Element &&
              event.target.closest(
                "[data-keybinding-capture], [role='dialog'], [role='alertdialog']",
              )
            ),
        },
      ),
      ...Object.entries(actions).map(([command, run]) => registerMenuAction(command, run)),
    ];
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, [keybindings, store]);
  const windows = Object.values(snapshot.windows);
  const left = panelVisible("left"),
    right = panelVisible("right"),
    floatingVisible = panelVisible("floating");
  const dockedThreads = groups.left.length === 1 && groups.left[0]?.active === "threads";
  const leftGridColumn = panelOpen("left") && !dockedThreads;
  const seamPx = 6;
  const leftReservedWidth = panelOpen("left") ? layout.sizes.left + seamPx : 0;
  const availableMainAndRight = Math.max(360, dockWidth - seamPx * 2 - leftReservedWidth);
  const effectiveRightWidth = rightContentMode
    ? Math.round(
        Math.max(
          260,
          Math.min(
            Math.max(260, availableMainAndRight - 280),
            (availableMainAndRight - seamPx) * layout.sizes.rightContentShare,
          ),
        ),
      )
    : layout.sizes.right;
  useDockedPanelMotion(store.getBody, dockedThreads ? panelOpen("left") : null, layout.sizes.left);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync, react/exhaustive-effect-dependencies -- Play from the captured bounds after React and the dock tracks commit their final geometry.
  useLayoutEffect(() => playResize(), [snapshot, playResize]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync, react/exhaustive-effect-dependencies -- repositions native browser layers after docking changes that do not resize their content
  useLayoutEffect(() => notifyWorkspaceLayout(), [layout]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- install dismissal before the restored floating window can receive its next key.
  useLayoutEffect(() => {
    if (!floatingVisible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.shiftKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.defaultPrevented
      )
        return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[role='dialog'], [role='menu'], [data-workspace-dragging]")) return;
      event.preventDefault();
      store.hidePanel("floating");
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [floatingVisible, store]);
  const mounted = new Set<string>();
  const renderGroupWindows = (group: (typeof groups)["main"][number]) =>
    group.windows.map((id) => {
      const window = snapshot.windows[id]!;
      mounted.add(id);
      const activeId =
        full && layout.placements[full.windowId]?.group === group.id ? full.windowId : group.active;
      const active = activeId === id;
      return (
        <div
          key={id}
          hidden={!active}
          inert={!active}
          className="relative flex h-full min-h-0 min-w-0 flex-col"
        >
          <PortalMount node={window.container} className="h-full min-h-0 min-w-0 flex-1" />
        </div>
      );
    });
  const lastRightWindow = useLastDockWindow(groups.right[0]?.active);
  const renderTabs = (tabs: { id: string; group: string; key: WorkspacePanel }[]) => {
    const rightHasContentTab =
      tabs[0]?.key === "right" && tabs.some(({ id }) => !isInspectorWorkspaceWindowId(id));
    const orderedTabs =
      tabs[0]?.key === "right"
        ? [
            ...tabs.filter(({ id }) => isInspectorWorkspaceWindowId(id)),
            ...tabs.filter(({ id }) => !isInspectorWorkspaceWindowId(id)),
          ]
        : tabs;
    return orderedTabs.map(({ id, group, key }, index) => {
      const selected =
        (full ? full.windowId === id : false) ||
        (!full &&
          (layout.active[group] === id || groups[key].some((value) => value.active === id)));
      const pinnedInspector = key === "right" && isInspectorWorkspaceWindowId(id);
      const compactInspector = pinnedInspector && rightHasContentTab;
      const showDividerAfter =
        compactInspector &&
        index + 1 < orderedTabs.length &&
        !isInspectorWorkspaceWindowId(orderedTabs[index + 1]!.id);
      return (
        <Fragment key={id}>
          <button
            role="tab"
            aria-selected={selected}
            aria-label={snapshot.windows[id]!.title}
            draggable={!snapshot.windows[id]!.fixed && !pinnedInspector}
            onDragStart={(event) => event.dataTransfer.setData("application/x-t3-window", id)}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes("application/x-t3-window"))
                event.preventDefault();
            }}
            onDrop={(event) => {
              const source = event.dataTransfer.getData("application/x-t3-window");
              if (source) {
                event.preventDefault();
                store.move(source, { panel: key, group });
              }
            }}
            onClick={() => store.activate(id)}
            onDoubleClick={(event) => {
              if (event.target instanceof Element && event.target.closest("[role='button']"))
                return;
              if (store.toggleMaximizeInApp(id)) event.stopPropagation();
            }}
            onAuxClick={(event) => {
              if (event.button === 1 && !pinnedInspector) store.close(id);
            }}
            className={cn(
              "workspace-window-label group flex h-6 max-w-44 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-[background-color,color,box-shadow] hover:bg-foreground/6 hover:text-foreground",
              compactInspector && "px-1.5",
              selected && "workspace-panel-tab-selected font-medium",
            )}
          >
            {snapshot.windows[id]!.icon ? (
              <span aria-hidden className="relative flex shrink-0 items-center">
                {snapshot.windows[id]!.icon}
              </span>
            ) : null}
            {compactInspector ? null : (
              <span className="truncate">{snapshot.windows[id]!.title}</span>
            )}
            {snapshot.windows[id]!.fixed ||
            !snapshot.windows[id]!.closable ||
            pinnedInspector ? null : (
              <span
                role="button"
                aria-label={`Close ${snapshot.windows[id]!.title}`}
                tabIndex={0}
                className="grid size-3.5 shrink-0 place-items-center rounded-sm opacity-0 transition-opacity hover:bg-foreground/10 group-hover:opacity-100 group-focus-within:opacity-100"
                onClick={(event) => {
                  event.stopPropagation();
                  store.close(id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    store.close(id);
                  }
                }}
              >
                <XIcon className="size-3" />
              </span>
            )}
          </button>
          {showDividerAfter ? (
            <span aria-hidden className="mx-0.5 h-3 w-px shrink-0 bg-foreground/12" />
          ) : null}
        </Fragment>
      );
    });
  };
  const panel = (key: Exclude<WorkspacePanel, "floating">) => {
    if (key === "left" && groups.left.length === 0) return null;
    let panelGroups = groups[key];
    if (key === "right" && panelGroups.length === 0) {
      // A window shortcut dismisses the last tab before its dock finishes sliding out.
      const id = lastRightWindow;
      const placement = id && layout.placements[id];
      if (
        id &&
        placement &&
        placement.panel === key &&
        snapshot.windows[id]?.available &&
        layout.dismissed.includes(id)
      ) {
        panelGroups = [{ id: placement.group, windows: [id], active: id }];
      }
    }
    const isStage = full !== null && fullPanel === key;
    const zoomedId = isStage
      ? layout.placements[full.windowId]!.group
      : layout.panelZoomedGroup[key];
    const visibleGroups =
      zoomedId && panelGroups.some((group) => group.id === zoomedId)
        ? panelGroups.filter((group) => group.id === zoomedId)
        : panelGroups;
    const isVertical = Boolean(layout.vertical[key]);
    const threadSidebar = key === "left" && dockedThreads;
    const tabs = panelGroups.flatMap((group) =>
      group.windows.map((id) => ({ id, group: group.id, key })),
    );
    const showTabs = isStage
      ? !isChatWorkspaceWindowId(full.windowId)
      : tabs.length > 1 ||
        key === "right" ||
        (key === "main" && tabs.length === 1 && !isChatWorkspaceWindowId(tabs[0]!.id));
    const maximizeTarget = isStage
      ? full.windowId
      : key === "right"
        ? (
            visibleGroups.find(
              (group) =>
                group.active === snapshot.focused && canMaximizeWorkspaceWindowInApp(group.active),
            ) ?? visibleGroups.find((group) => canMaximizeWorkspaceWindowInApp(group.active))
          )?.active
        : undefined;
    const rightMenuTarget =
      key === "right" && showTabs && panelGroups.length === 1
        ? (() => {
            const candidate = visibleGroups[0]?.active;
            return candidate && !snapshot.windows[candidate]?.fixed ? candidate : undefined;
          })()
        : undefined;
    const raiseRightCard = key === "right" && rightContentMode;
    const maximizeLabel = isStage ? "Restore from app maximize" : "Maximize in app";
    const panelBody = (
      <>
        {showTabs ? (
          <div
            className={cn(
              "workspace-panel-heading drag-region",
              (raiseRightCard || isStage) && "border-b border-border/60",
            )}
            data-workspace-panel-heading={key}
            data-workspace-stage-heading={isStage ? "" : undefined}
            onDoubleClick={(event) => {
              if (
                event.target instanceof Element &&
                event.target.closest("button, [role='button']")
              )
                return;
              const group =
                visibleGroups.find((group) => group.active === snapshot.focused) ??
                visibleGroups[0];
              if (group && store.toggleMaximizeInApp(group.active)) event.stopPropagation();
            }}
          >
            <div
              role="tablist"
              aria-label={panelLabels[key]}
              className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]"
            >
              {renderTabs(tabs)}
            </div>
            {key === "right" ? (
              <div
                data-workspace-panel-actions="right"
                className="flex shrink-0 items-center gap-1"
              >
                <PortalMount node={store.getActionsContainer("panel:right")} />
                {rightMenuTarget ? <DockMenu store={store} id={rightMenuTarget} /> : null}
              </div>
            ) : null}
            {maximizeTarget ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon-xs"
                      variant="ghost-muted"
                      aria-label={maximizeLabel}
                      onClick={() => store.toggleMaximizeInApp(maximizeTarget)}
                    />
                  }
                >
                  {isStage ? (
                    <Minimize2Icon className="size-3.5" />
                  ) : (
                    <Maximize2Icon className="size-3.5" />
                  )}
                </TooltipTrigger>
                <TooltipPopup>
                  <span>{maximizeLabel}</span>{" "}
                  <kbd>
                    {shortcutLabelForCommand(keybindings, "workspace.toggleMaximizeInApp") ??
                      "⇧Esc"}
                  </kbd>
                </TooltipPopup>
              </Tooltip>
            ) : null}
          </div>
        ) : null}
        <div className={cn("relative flex min-h-0 min-w-0 flex-1", isVertical && "flex-col")}>
          {panelGroups.map((group) => {
            const isHiddenByZoom =
              Boolean(zoomedId) &&
              visibleGroups.length === 1 &&
              panelGroups.length > 1 &&
              group.id !== zoomedId;
            const visibleIdx = visibleGroups.findIndex((item) => item.id === group.id);
            const weight = layout.groupWeights[group.id] ?? 1;
            const raiseCard = key === "main" && !isStage;
            return (
              <Fragment key={group.id}>
                {visibleIdx > 0 ? (
                  <GroupResize
                    store={store}
                    panel={key}
                    vertical={isVertical}
                    beforeGroupId={visibleGroups[visibleIdx - 1]!.id}
                    afterGroupId={group.id}
                  />
                ) : null}
                <div
                  hidden={isHiddenByZoom}
                  inert={isHiddenByZoom}
                  data-workspace-group={group.id}
                  data-workspace-owner={key}
                  style={isHiddenByZoom ? undefined : { flex: `${weight} ${weight} 0%` }}
                  className={cn(
                    "relative flex min-h-0 min-w-0 flex-col overflow-hidden",
                    raiseCard && "workspace-window-card workspace-window-surface-main",
                    raiseRightCard &&
                      visibleIdx > 0 &&
                      (isVertical ? "border-t border-border/60" : "border-l border-border/60"),
                  )}
                >
                  {renderGroupWindows(group)}
                </div>
              </Fragment>
            );
          })}
        </div>
      </>
    );
    return (
      <section
        key={key}
        hidden={!isStage && key === "left" && !panelOpen(key) && !threadSidebar}
        inert={!isStage && !panelVisible(key)}
        aria-label={isStage ? snapshot.windows[full.windowId]?.title : panelLabels[key]}
        data-workspace-covered={full && !isStage && panelOpen(key) ? "" : undefined}
        data-workspace-maximized-stage={isStage ? "full" : undefined}
        data-workspace-panel={key}
        data-workspace-right-mode={
          key === "right" ? (rightContentMode ? "content" : "inspector") : undefined
        }
        data-workspace-panel-zoomed={
          zoomedId && visibleGroups.length === 1 && panelGroups.length > 1 ? "" : undefined
        }
        data-workspace-group={key === "main" && groups.main.length === 0 ? "main" : undefined}
        data-workspace-owner={key === "main" && groups.main.length === 0 ? "main" : undefined}
        className={cn(
          "relative isolate flex min-h-0 min-w-0 flex-col overflow-visible",
          threadSidebar && "workspace-docked-sidebar",
          key === "right" && "workspace-docked-right",
          key === "main" &&
            groups.main.length === 0 &&
            "workspace-window-card workspace-window-surface-main",
        )}
        style={
          isStage
            ? undefined
            : {
                gridArea: threadSidebar ? undefined : key,
                width: threadSidebar ? layout.sizes.left : undefined,
              }
        }
      >
        <div
          data-workspace-panel-surface=""
          data-workspace-right-card={raiseRightCard ? "" : undefined}
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col",
            (raiseRightCard || isStage) &&
              "workspace-window-card workspace-window-surface-main overflow-hidden",
          )}
        >
          {panelBody}
        </div>
        {!isStage && (key === "left" || key === "right") ? (
          <PanelResize
            store={store}
            panel={key}
            rightContentMode={key === "right" && rightContentMode}
            availableMainAndRight={availableMainAndRight}
            currentRightWidth={effectiveRightWidth}
          />
        ) : null}
      </section>
    );
  };
  const renderPanelToggle = (key: "left" | "right") => {
    const [Icon, command] = (
      {
        left: [PanelLeftIcon, "sidebar.toggle"],
        right: [PanelRightIcon, "rightPanel.toggle"],
      } as const
    )[key];
    const shortcut = shortcutLabelForCommand(keybindings, command);
    return (
      <Tooltip key={key}>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="group/panel-toggle relative grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors duration-150 ease-(--ease-drawer) hover:bg-accent hover:text-foreground aria-pressed:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring focus-visible:bg-accent motion-reduce:duration-0 in-data-[panel-animations=false]:duration-0 pointer-coarse:after:absolute pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 [-webkit-app-region:no-drag]"
              aria-label={`Toggle ${panelLabels[key]}`}
              aria-pressed={panelVisible(key)}
              onClick={() => store.togglePanel(key)}
            />
          }
        >
          <Icon className="size-3.5" aria-hidden>
            <path
              d={key === "left" ? "m16 15-3-3 3-3" : "m8 9 3 3-3 3"}
              className="opacity-0 transition-opacity duration-150 ease-(--ease-drawer) group-aria-pressed/panel-toggle:opacity-100 motion-reduce:duration-0 in-data-[panel-animations=false]:duration-0"
            />
          </Icon>
        </TooltipTrigger>
        <TooltipPopup>
          {panelLabels[key]}
          {shortcut ? ` (${shortcut})` : ""}
        </TooltipPopup>
      </Tooltip>
    );
  };
  const panelControls = (
    <div
      data-workspace-controls=""
      className="pointer-events-none absolute inset-x-0 z-30 flex h-[var(--workspace-topbar-height)] items-center justify-between"
    >
      <div className="pointer-events-auto flex" data-workspace-controls-leading="">
        {renderPanelToggle("left")}
      </div>
      <div className="pointer-events-auto flex items-center gap-1">
        {groups.floating.length > 0 ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="group/panel-toggle relative grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors duration-150 ease-(--ease-drawer) hover:bg-accent hover:text-foreground aria-pressed:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring focus-visible:bg-accent motion-reduce:duration-0 in-data-[panel-animations=false]:duration-0 pointer-coarse:after:absolute pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 [-webkit-app-region:no-drag]"
                  aria-label={`Toggle ${panelLabels.floating}`}
                  aria-pressed={floatingVisible}
                  onClick={() => store.togglePanel("floating")}
                />
              }
            >
              <LayersIcon className="size-3.5" aria-hidden />
            </TooltipTrigger>
            <TooltipPopup>{panelLabels.floating}</TooltipPopup>
          </Tooltip>
        ) : null}
        {renderPanelToggle("right")}
      </div>
    </div>
  );
  const panels = (["left", "main", "right"] as const).map(panel);
  const floatingTabs = groups.floating.flatMap((group) =>
    group.windows.map((id) => ({ id, group: group.id, key: "floating" as const })),
  );
  const activeFloatingId = maximizedFloating && full ? full.windowId : groups.floating[0]?.active;
  const activeFloatingWindow = activeFloatingId ? snapshot.windows[activeFloatingId] : undefined;
  const dockTargetPanel =
    activeFloatingWindow && activeFloatingWindow.defaultPanel !== "floating"
      ? activeFloatingWindow.defaultPanel
      : "right";
  const floatingOverlay =
    groups.floating.length > 0 ? (
      <div
        data-workspace-floating-overlay=""
        hidden={!floatingVisible && !maximizedFloating}
        inert={!floatingVisible && !maximizedFloating}
        data-workspace-floating-full={maximizedFloating ? "" : undefined}
        className="absolute inset-0 z-40 flex items-center justify-center p-5 transition-opacity duration-150 sm:p-8 [-webkit-app-region:no-drag]"
      >
        <div
          aria-hidden
          data-workspace-floating-backdrop=""
          hidden={maximizedFloating}
          className="dialog-backdrop absolute inset-0"
          onClick={() => store.hidePanel("floating")}
        />
        <section
          aria-label={panelLabels.floating}
          data-workspace-panel="floating"
          data-workspace-maximized-stage={maximizedFloating ? "full" : undefined}
          className="relative z-10 flex h-full max-h-[820px] w-full max-w-[1060px] min-h-0 min-w-0 flex-col"
        >
          <div
            data-workspace-panel-surface=""
            className={cn(
              "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
              maximizedFloating
                ? "workspace-window-card workspace-window-surface-main"
                : "workspace-window-surface-floating rounded-2xl border",
            )}
          >
            {!(
              maximizedFloating &&
              activeFloatingId &&
              isChatWorkspaceWindowId(activeFloatingId)
            ) && (
              <div
                onDoubleClick={(event) => {
                  if (
                    event.target instanceof Element &&
                    event.target.closest("button, [role='button']")
                  )
                    return;
                  if (activeFloatingId && store.toggleMaximizeInApp(activeFloatingId))
                    event.stopPropagation();
                }}
                data-workspace-stage-heading={maximizedFloating ? "" : undefined}
                className={
                  maximizedFloating
                    ? "workspace-panel-heading drag-region border-b border-border/60"
                    : "flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3.5"
                }
              >
                <div
                  role="tablist"
                  aria-label={panelLabels.floating}
                  className="flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]"
                >
                  {floatingTabs.length > 1 || maximizedFloating ? (
                    renderTabs(floatingTabs)
                  ) : activeFloatingWindow ? (
                    <div className="flex min-w-0 items-center gap-2 text-foreground">
                      {activeFloatingWindow.icon ? (
                        <span
                          aria-hidden
                          className="flex shrink-0 items-center text-muted-foreground"
                        >
                          {activeFloatingWindow.icon}
                        </span>
                      ) : null}
                      <span className="workspace-window-label truncate text-foreground">
                        {activeFloatingWindow.title}
                      </span>
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {maximizedFloating && activeFloatingId ? (
                    <Button
                      size="icon-xs"
                      variant="ghost-muted"
                      aria-label="Restore from app maximize"
                      onClick={() => store.toggleMaximizeInApp(activeFloatingId)}
                    >
                      <Minimize2Icon className="size-3.5" />
                    </Button>
                  ) : activeFloatingWindow && !activeFloatingWindow.fixed ? (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            size="icon-xs"
                            variant="ghost-muted"
                            aria-label={`Move to ${panelLabels[dockTargetPanel]}`}
                            onClick={() =>
                              store.move(activeFloatingWindow.id, {
                                panel: dockTargetPanel,
                                group: dockTargetPanel,
                              })
                            }
                          />
                        }
                      >
                        <Minimize2Icon className="size-3.5" />
                      </TooltipTrigger>
                      <TooltipPopup>Move to {panelLabels[dockTargetPanel]}</TooltipPopup>
                    </Tooltip>
                  ) : null}
                  {!maximizedFloating && (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            size="icon-xs"
                            variant="ghost-muted"
                            aria-label={`Close ${panelLabels.floating}`}
                            onClick={() => store.hidePanel("floating")}
                          />
                        }
                      >
                        <XIcon className="size-3.5" />
                      </TooltipTrigger>
                      <TooltipPopup>Close (Esc)</TooltipPopup>
                    </Tooltip>
                  )}
                </div>
              </div>
            )}
            <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
              {groups.floating.map((group) => (
                <div
                  key={group.id}
                  data-workspace-group={group.id}
                  hidden={
                    (maximizedFloating &&
                      full &&
                      group.id !== layout.placements[full.windowId]!.group) ||
                    undefined
                  }
                  data-workspace-owner="floating"
                  className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
                >
                  {renderGroupWindows(group)}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    ) : null;
  return (
    <div
      className="relative flex h-full min-h-0 w-full flex-1 flex-col bg-(--workspace-board)"
      data-workspace-dock=""
      data-workspace-maximized={activeMax?.stage}
      data-left-open={left}
      data-right-open={right}
      data-has-floating={groups.floating.length > 0 || undefined}
      onDoubleClick={(event) => {
        const target = event.target;
        if (!(target instanceof Element) || target.closest("button, input, a, [role='button']"))
          return;
        if (!target.closest("[data-workspace-chat-heading]")) return;
        const id = target.closest<HTMLElement>("[data-workspace-window]")?.dataset.workspaceWindow;
        if (store.toggleMaximizeInApp(id)) event.stopPropagation();
      }}
    >
      {!isElectron && panelControls}
      {controls}
      <div
        ref={(node) => store.setBody(node)}
        className="relative grid min-h-0 flex-1 gap-(--workspace-seam) overflow-clip p-(--workspace-seam)"
        style={{
          gap: 0,
          gridTemplateColumns: `${leftGridColumn ? `${layout.sizes.left}px var(--workspace-seam) ` : ""}minmax(0,1fr) ${panelOpen("right") ? `calc(${effectiveRightWidth}px + var(--workspace-seam))` : "0px"}`,
          gridTemplateRows: "minmax(0,1fr)",
          gridTemplateAreas: leftGridColumn ? '"left . main right"' : '"main right"',
        }}
      >
        <div className="pointer-events-none invisible absolute inset-0" aria-hidden inert>
          {children}
        </div>
        {panels}
        {activeMax?.stage === "full" ? (
          <>
            <button
              type="button"
              aria-label="Peek left workspace column"
              data-workspace-edge-peek="left"
              onClick={() => store.focusDirection("left")}
              className="absolute inset-y-3 left-0.5 z-30 w-1 cursor-pointer rounded-full bg-foreground/15 opacity-60 transition-all hover:w-1.5 hover:bg-primary hover:opacity-100"
            />
            {isChatWorkspaceWindowId(activeMax.windowId) && groups.right.length > 0 ? (
              <button
                type="button"
                aria-label="Peek right workspace column"
                data-workspace-edge-peek="right"
                onClick={() => store.focusDirection("right")}
                className="absolute inset-y-3 right-0.5 z-30 w-1 cursor-pointer rounded-full bg-foreground/15 opacity-60 transition-all hover:w-1.5 hover:bg-primary hover:opacity-100"
              />
            ) : null}
          </>
        ) : null}
        {chatPresent && snapshot.windows.route ? (
          <PortalMount
            node={snapshot.windows.route.container}
            className="pointer-events-none invisible absolute inset-0"
          />
        ) : null}
        <div
          ref={(node) => store.setParking(node)}
          className="pointer-events-none absolute inset-0 -z-10"
        />
        {windows
          .filter((window) => !mounted.has(window.id) && window.id !== "route")
          .map((window) => (
            <div key={window.id} className="workspace-window-card hidden overflow-hidden" inert>
              <PortalMount node={window.container} className="h-full min-h-0 min-w-0" />
            </div>
          ))}
      </div>
      {/* Electron applies native drag regions in layout order, regardless of z-index. */}
      {isElectron && panelControls}
      {floatingOverlay}
    </div>
  );
}
function DockMenu({ store, id }: { store: DockStore; id: string }) {
  const panelLabels = workspacePanelLabel();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const placement = snapshot.layout.placements[id];
  const groupsInPanel = placement
    ? workspaceGroups(snapshot.layout, Object.values(snapshot.windows), placement.panel)
    : [];
  const canMaxInPanel =
    Boolean(placement && placement.panel !== "floating") &&
    (groupsInPanel.length > 1 ||
      Boolean(placement && snapshot.layout.panelZoomedGroup[placement.panel]));
  const isMaxInPanel = Boolean(
    placement && snapshot.layout.panelZoomedGroup[placement.panel] === placement.group,
  );
  const canMaxInApp = canMaximizeWorkspaceWindowInApp(id);
  const isMaxInApp = snapshot.layout.maximized?.windowId === id;
  const split = (edge: "right" | "bottom") => {
    const position = store.getSnapshot().layout.placements[id];
    if (position) store.move(id, position, edge);
  };
  return (
    <Menu>
      <MenuTrigger
        render={<Button size="icon-xs" variant="ghost-muted" aria-label="Window actions" />}
      >
        <EllipsisIcon className="size-3.5" />
      </MenuTrigger>
      <MenuPopup>
        {canMaxInApp ? (
          <MenuItem onClick={() => store.toggleMaximizeInApp(id)}>
            {isMaxInApp ? <Minimize2Icon /> : <Maximize2Icon />}
            <span>{isMaxInApp ? "Restore from app maximize" : "Maximize in app"}</span>
          </MenuItem>
        ) : null}
        {canMaxInPanel ? (
          <MenuItem onClick={() => store.toggleMaximizeInPanel(id)}>
            {isMaxInPanel ? <Minimize2Icon /> : <Maximize2Icon />}
            <span>{isMaxInPanel ? "Restore split in panel" : "Maximize in panel"}</span>
          </MenuItem>
        ) : null}
        {canMaxInApp || canMaxInPanel ? <MenuSeparator /> : null}
        {workspacePanels.map((panel) => (
          <MenuItem key={panel} onClick={() => store.move(id, { panel, group: panel })}>
            Move to {panelLabels[panel]}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem onClick={() => split("right")}>
          <Columns2Icon />
          <span>Split horizontally</span>
        </MenuItem>
        <MenuItem onClick={() => split("bottom")}>
          <Rows2Icon />
          <span>Split vertically</span>
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

function GroupResize({
  store,
  panel,
  vertical,
  beforeGroupId,
  afterGroupId,
}: {
  store: DockStore;
  panel: Exclude<WorkspacePanel, "floating">;
  vertical: boolean;
  beforeGroupId: string;
  afterGroupId: string;
}) {
  const panelLabels = workspacePanelLabel();
  return (
    <div
      role="separator"
      aria-label={`Resize split in ${panelLabels[panel]}`}
      aria-orientation={vertical ? "horizontal" : "vertical"}
      data-workspace-group-resize=""
      className={cn(
        "group/resize relative z-20 flex shrink-0 touch-none items-center justify-center before:absolute before:-inset-1",
        vertical
          ? "h-(--workspace-seam) w-full cursor-row-resize"
          : "h-full w-(--workspace-seam) cursor-col-resize",
      )}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const current = store.getSnapshot().layout;
        const nextWeights = { ...current.groupWeights };
        delete nextWeights[beforeGroupId];
        delete nextWeights[afterGroupId];
        store.updateLayout({ ...current, groupWeights: nextWeights });
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        const node = event.currentTarget;
        const parent = node.parentElement;
        const beforeEl = node.previousElementSibling as HTMLElement | null;
        const afterEl = node.nextElementSibling as HTMLElement | null;
        if (!parent || !beforeEl || !afterEl) return;
        node.setPointerCapture(event.pointerId);
        const beforeRect = beforeEl.getBoundingClientRect();
        const afterRect = afterEl.getBoundingClientRect();
        const beforeStartPx = vertical ? beforeRect.height : beforeRect.width;
        const afterStartPx = vertical ? afterRect.height : afterRect.width;
        const totalPx = Math.max(1, beforeStartPx + afterStartPx);
        const initLayout = store.getSnapshot().layout;
        const wBefore0 = initLayout.groupWeights[beforeGroupId] ?? 1;
        const wAfter0 = initLayout.groupWeights[afterGroupId] ?? 1;
        const sumWeight = wBefore0 + wAfter0;
        const startPos = vertical ? event.clientY : event.clientX;
        const minPx = Math.min(120, totalPx * 0.25);
        const move = (next: PointerEvent) => {
          const delta = (vertical ? next.clientY : next.clientX) - startPos;
          const nextBeforePx = Math.max(minPx, Math.min(totalPx - minPx, beforeStartPx + delta));
          const ratio = nextBeforePx / totalPx;
          const current = store.getSnapshot().layout;
          store.updateLayout(
            {
              ...current,
              groupWeights: {
                ...current.groupWeights,
                [beforeGroupId]: Math.max(0.1, sumWeight * ratio),
                [afterGroupId]: Math.max(0.1, sumWeight * (1 - ratio)),
              },
            },
            false,
          );
        };
        const stop = () => {
          store.updateLayout(store.getSnapshot().layout);
          node.removeEventListener("pointermove", move);
          node.removeEventListener("pointerup", stop);
          node.removeEventListener("pointercancel", stop);
        };
        node.addEventListener("pointermove", move);
        node.addEventListener("pointerup", stop);
        node.addEventListener("pointercancel", stop);
      }}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none shrink-0 rounded-full bg-foreground/40 opacity-0 group-hover/resize:opacity-100 group-active/resize:opacity-100",
          vertical ? "h-[2px] w-8" : "h-8 w-[2px]",
        )}
      />
    </div>
  );
}

function PanelResize({
  store,
  panel,
  rightContentMode = false,
  availableMainAndRight = 900,
  currentRightWidth = 280,
}: {
  store: DockStore;
  panel: "left" | "right";
  rightContentMode?: boolean;
  availableMainAndRight?: number;
  currentRightWidth?: number;
}) {
  const panelLabels = workspacePanelLabel();
  return (
    <div
      role="separator"
      aria-label={`Resize ${panelLabels[panel]}`}
      aria-orientation="vertical"
      className={cn(
        "group/resize absolute inset-y-0 z-20 flex w-(--workspace-seam) cursor-col-resize touch-none items-center justify-center before:absolute before:-inset-1",
        panel === "left" ? "-right-(--workspace-seam)" : "-left-(--workspace-seam)",
      )}
      onDoubleClick={(event) => {
        if (panel !== "right") return;
        event.preventDefault();
        event.stopPropagation();
        const current = store.getSnapshot().layout;
        store.updateLayout({
          ...current,
          sizes: rightContentMode
            ? { ...current.sizes, rightContentShare: 0.5 }
            : { ...current.sizes, right: 280 },
        });
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        const node = event.currentTarget;
        node.setPointerCapture(event.pointerId);
        const initial =
          panel === "right" && rightContentMode
            ? currentRightWidth
            : store.getSnapshot().layout.sizes[panel];
        const start = event.clientX;
        const move = (next: PointerEvent) => {
          const delta = next.clientX - start;
          const current = store.getSnapshot().layout;
          if (panel === "right" && rightContentMode) {
            const span = Math.max(1, availableMainAndRight - 6);
            const nextPx = Math.max(
              260,
              Math.min(Math.max(260, availableMainAndRight - 280), initial - delta),
            );
            const share = Math.max(0.25, Math.min(0.75, nextPx / span));
            store.updateLayout(
              { ...current, sizes: { ...current.sizes, rightContentShare: share } },
              false,
            );
            return;
          }
          const value = Math.max(
            panel === "left" ? workspaceLeftMinWidth : 180,
            Math.min(600, initial + (panel === "left" ? delta : -delta)),
          );
          store.updateLayout({ ...current, sizes: { ...current.sizes, [panel]: value } }, false);
        };
        const stop = () => {
          store.updateLayout(store.getSnapshot().layout);
          node.removeEventListener("pointermove", move);
          node.removeEventListener("pointerup", stop);
          node.removeEventListener("pointercancel", stop);
        };
        node.addEventListener("pointermove", move);
        node.addEventListener("pointerup", stop);
        node.addEventListener("pointercancel", stop);
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none h-8 w-[2px] shrink-0 rounded-full bg-foreground/40 opacity-0 group-hover/resize:opacity-100 group-active/resize:opacity-100"
      />
    </div>
  );
}
function WindowGrab({ store, id, title }: { store: DockStore; id: string; title: string }) {
  const gesture = useRef<(() => void) | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- releases document pointer listeners if a dragged resource is closed
  useEffect(() => () => gesture.current?.(), [gesture]);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            data-workspace-grab=""
            aria-label={`Drag ${title}`}
            className="absolute top-0 left-1/2 z-20 grid h-3 w-16 -translate-x-1/2 cursor-grab touch-none place-items-center rounded-b-lg opacity-0 hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing [-webkit-app-region:no-drag] pointer-coarse:opacity-75"
            onDoubleClick={(event) => {
              if (store.toggleMaximizeInApp(id)) {
                event.preventDefault();
                event.stopPropagation();
              }
            }}
            onPointerDown={(event) => {
              const body = store.getBody(),
                window = store.getSnapshot().windows[id];
              if (!body || !window || event.button !== 0) return;
              gesture.current?.();
              event.preventDefault();
              const handle = event.currentTarget,
                node = window.container,
                rect = node.getBoundingClientRect(),
                origin = body.getBoundingClientRect();
              const placeholder = node.parentElement;
              if (!placeholder) return;
              const pointerId = event.pointerId,
                x = event.clientX,
                y = event.clientY;
              let started = false,
                target: WindowPlacement | null = null,
                edge: WorkspaceEdge | undefined;
              const guide = document.createElement("div");
              guide.className =
                "pointer-events-none absolute z-50 rounded-lg border-2 border-primary bg-primary/15";
              guide.dataset.workspaceDropGuide = "";
              const move = (next: PointerEvent) => {
                if (next.pointerId !== pointerId) return;
                if (!started && Math.hypot(next.clientX - x, next.clientY - y) < 4) return;
                if (!started) {
                  started = true;
                  node.dataset.workspaceDragging = "";
                  moveContainer(body, node);
                  Object.assign(node.style, {
                    position: "absolute",
                    zIndex: "100",
                    pointerEvents: "none",
                    width: `${rect.width}px`,
                    height: `${rect.height}px`,
                    left: `${rect.left - origin.left}px`,
                    top: `${rect.top - origin.top}px`,
                    boxShadow: "0 18px 56px #0006",
                  });
                  handle.setPointerCapture(pointerId);
                }
                node.style.transform = `translate(${next.clientX - x}px,${next.clientY - y}px)`;
                notifyWorkspaceLayout();
                const hit = document
                  .elementFromPoint(next.clientX, next.clientY)
                  ?.closest<HTMLElement>("[data-workspace-group]");
                target = null;
                edge = undefined;
                guide.remove();
                const px = next.clientX - origin.left,
                  py = next.clientY - origin.top;
                const dockPanel =
                  !next.altKey && px >= 0 && py >= 0 && px <= origin.width && py <= origin.height
                    ? px < 24
                      ? "left"
                      : px > origin.width - 24
                        ? "right"
                        : null
                    : null;
                if (dockPanel) {
                  const snapshot = store.getSnapshot(),
                    first = workspaceGroups(
                      snapshot.layout,
                      Object.values(snapshot.windows),
                      dockPanel,
                    )[0];
                  target = { panel: dockPanel, group: first?.id ?? dockPanel };
                  const width = snapshot.layout.sizes[dockPanel],
                    height = origin.height;
                  Object.assign(guide.style, {
                    left: `${dockPanel === "right" ? Math.max(0, origin.width - width) : 0}px`,
                    top: "0px",
                    width: `${Math.min(origin.width, width)}px`,
                    height: `${Math.min(origin.height, height)}px`,
                  });
                  body.append(guide);
                } else if (hit && !next.altKey) {
                  const group = hit.dataset.workspaceGroup,
                    panel = hit.dataset.workspaceOwner as WorkspacePanel;
                  if (group && panel) {
                    target = { panel, group };
                    const bounds = hit.getBoundingClientRect(),
                      rx = (next.clientX - bounds.left) / bounds.width,
                      ry = (next.clientY - bounds.top) / bounds.height;
                    edge =
                      rx < 0.2
                        ? "left"
                        : rx > 0.8
                          ? "right"
                          : ry < 0.2
                            ? "top"
                            : ry > 0.8
                              ? "bottom"
                              : undefined;
                    const width =
                      edge === "left" || edge === "right" ? bounds.width / 2 : bounds.width;
                    const height =
                      edge === "top" || edge === "bottom" ? bounds.height / 2 : bounds.height;
                    Object.assign(guide.style, {
                      left: `${bounds.left - origin.left + (edge === "right" ? width : 0)}px`,
                      top: `${bounds.top - origin.top + (edge === "bottom" ? height : 0)}px`,
                      width: `${width}px`,
                      height: `${height}px`,
                    });
                    body.append(guide);
                  }
                }
              };
              const finish = (next?: PointerEvent, cancel = false) => {
                if (next && next.pointerId !== pointerId) return;
                document.removeEventListener("pointermove", move);
                document.removeEventListener("pointerup", up);
                document.removeEventListener("pointercancel", abort);
                document.removeEventListener("keydown", key, true);
                gesture.current = null;
                guide.remove();
                if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
                if (!started) return;
                node.removeAttribute("style");
                delete node.dataset.workspaceDragging;
                moveContainer(placeholder, node);
                notifyWorkspaceLayout();
                if (cancel || !next) return;
                if (target) store.move(id, target, edge);
                else {
                  const current = store.getSnapshot().layout,
                    width = Math.min(650, Math.max(240, Math.min(origin.width, rect.width))),
                    height = Math.min(520, Math.max(160, Math.min(origin.height, rect.height)));
                  store.updateLayout({
                    ...current,
                    floating: {
                      x: Math.max(
                        0,
                        Math.min(origin.width - width, next.clientX - origin.left - width / 2),
                      ),
                      y: Math.max(
                        0,
                        Math.min(origin.height - height, next.clientY - origin.top - 12),
                      ),
                      width,
                      height,
                    },
                  });
                  store.move(id, { panel: "floating", group: "floating" });
                }
              };
              const up = (next: PointerEvent) => finish(next),
                abort = () => finish(undefined, true),
                key = (next: KeyboardEvent) => {
                  if (next.key === "Escape") {
                    next.preventDefault();
                    next.stopPropagation();
                    abort();
                  }
                };
              gesture.current = abort;
              document.addEventListener("pointermove", move);
              document.addEventListener("pointerup", up);
              document.addEventListener("pointercancel", abort);
              document.addEventListener("keydown", key, true);
            }}
          >
            <span className="h-[3px] w-8 rounded-full bg-muted-foreground" />
          </button>
        }
      />
      <TooltipPopup>Drag window; Option to float, Esc to cancel</TooltipPopup>
    </Tooltip>
  );
}
