import {
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
import { primaryServerKeybindingsAtom } from "../../state/server";
import { shortcutLabelForCommand } from "../../keybindings";
import {
  Columns2Icon,
  EllipsisIcon,
  LayersIcon,
  Minimize2Icon,
  PanelBottomIcon,
  PanelLeftIcon,
  PanelRightIcon,
  Rows2Icon,
  XIcon,
} from "lucide-react";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useStableCallback } from "../../hooks/useStableCallback";
import { isElectron } from "../../env";
import { notifyWorkspaceLayout } from "../../lib/workspaceLayoutEvents";
import { workspaceAreaProps } from "../../lib/workspaceFocus";
import { cn } from "../../lib/utils";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import {
  createWorkspaceLayout,
  moveWorkspaceWindow,
  restoreWorkspaceLayout,
  workspaceGroups,
  workspacePanels,
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
  titleContainer: HTMLElement;
  hasTitlebar: boolean;
  onActivate: () => void;
  onClose?: (() => void) | undefined;
}
interface DockSnapshot {
  windows: Record<string, DockWindow>;
  layout: WorkspaceLayout;
  focused: string | null;
}
function createDockStore() {
  let layout = createWorkspaceLayout();
  try {
    layout = restoreWorkspaceLayout(JSON.parse(localStorage.getItem(storageKey) ?? "null"));
  } catch {
    /* Storage is optional. */
  }
  let snapshot: DockSnapshot = { windows: {}, layout, focused: null };
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
  const updateLayout = (input: WorkspaceLayout, save = true) => {
    let next = input;
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
    for (const id of Object.keys(snapshot.windows)) {
      const previous = snapshot.layout.placements[id],
        placement = next.placements[id];
      if (previous?.panel !== placement?.panel || previous?.group !== placement?.group) park(id);
    }
    publish({ ...snapshot, layout: next }, save);
  };
  const activate = (id: string) => {
    const placement = snapshot.layout.placements[id];
    if (!placement) return;
    const window = snapshot.windows[id];
    publish(
      {
        ...snapshot,
        focused: id,
        layout: {
          ...snapshot.layout,
          active: { ...snapshot.layout.active, [placement.group]: id },
          hidden: { ...snapshot.layout.hidden, [placement.panel]: false },
          dismissed: snapshot.layout.dismissed.filter((value) => value !== id),
        },
      },
      true,
    );
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
      const members = workspaceGroups(snapshot.layout, Object.values(snapshot.windows), panel);
      if (members.length > 0) {
        updateLayout({
          ...snapshot.layout,
          hidden: { ...snapshot.layout.hidden, [panel]: !snapshot.layout.hidden[panel] },
        });
        return;
      }
      const window = Object.values(snapshot.windows).find(
        (value) => value.available && value.defaultPanel === panel && value.id !== "route",
      );
      if (window) {
        updateLayout(moveWorkspaceWindow(snapshot.layout, window.id, { panel, group: panel }));
        activate(window.id);
      } else openers[panel]?.();
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
        if (!window.selected && currentActive) {
          next = { ...next, active: { ...next.active, [panel]: currentActive } };
        }
      }
      if (
        window.available &&
        window.selected &&
        !restored &&
        (!previous?.selected || previous.activation !== window.activation)
      ) {
        const placement = next.placements[window.id]!;
        next = {
          ...next,
          active: { ...next.active, [placement.group]: window.id },
          hidden: { ...next.hidden, [placement.panel]: false },
          dismissed: next.dismissed.filter((id) => id !== window.id),
        };
      }
      publish({ ...snapshot, windows: { ...snapshot.windows, [window.id]: window }, layout: next });
    },
    unregister(id: string) {
      actionContainers.delete(id);
      const { [id]: _removed, ...windows } = snapshot.windows;
      publish({ ...snapshot, windows });
    },
    activate,
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
    close(id: string) {
      const window = snapshot.windows[id];
      if (window?.fixed || window?.closable === false) return;
      if (window?.onClose) window.onClose();
      else updateLayout({ ...snapshot.layout, dismissed: [...snapshot.layout.dismissed, id] });
    },
    move(id: string, target: WindowPlacement, edge?: WorkspaceEdge) {
      if (snapshot.windows[id]?.fixed) return;
      updateLayout(moveWorkspaceWindow(snapshot.layout, id, target, edge));
      activate(id);
    },
    updateLayout,
  };
}
type DockStore = ReturnType<typeof createDockStore>;
const DockContext = createContext<DockStore | null>(null);
const WindowContext = createContext<string | null>(null);
function visibleWindow(snapshot: DockSnapshot, id: string): boolean {
  const window = snapshot.windows[id];
  const placement = snapshot.layout.placements[id];
  if (!window?.available || !placement || snapshot.layout.hidden[placement.panel]) return false;
  const registered = Object.values(snapshot.windows);
  const chatPresent = registered.some((value) => value.available && value.id.startsWith("chat:"));
  if (id === "route" && chatPresent) return false;
  const windows = registered.filter((value) => value.id !== "route" || !chatPresent);
  return workspaceGroups(snapshot.layout, windows, placement.panel).some(
    (group) => group.active === id,
  );
}
export function useWorkspaceDockEnabled(): boolean {
  return use(DockContext) !== null;
}
export function useWorkspaceWindowVisible(): boolean | undefined {
  const store = use(DockContext);
  const id = use(WindowContext);
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
  titlebar?: ReactNode;
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
  const [titleContainer] = useState(() =>
    Object.assign(document.createElement("div"), { className: "flex min-w-0 flex-1 items-center" }),
  );
  const hasTitlebar = props.titlebar !== undefined;
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
        titleContainer,
        available: props.available ?? true,
        selected: props.selected ?? false,
        activation: props.activation,
        hasTitlebar,
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
    hasTitlebar,
    canClose,
    container,
    titleContainer,
    activate,
    close,
  ]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- unregisters the external window when its owning route or resource unmounts
  useLayoutEffect(() => () => store.unregister(props.id), [store, props.id]);
  return (
    <>
      {createPortal(
        <WindowContext value={props.id}>
          <WindowContents
            store={store}
            id={props.id}
            title={props.title}
            fixed={props.fixed ?? false}
          >
            {props.children}
          </WindowContents>
        </WindowContext>,
        container,
      )}
      {props.titlebar === undefined ? null : createPortal(props.titlebar, titleContainer)}
    </>
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
  const [visited, setVisited] = useState(false);
  if (visible && !visited) setVisited(true);
  const activate = () => {
    if ((id !== "route" || visible) && store.getSnapshot().focused !== id) store.activate(id);
  };
  return visible || visited || id === "route" ? (
    <div
      className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col"
      data-workspace-window={id}
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
            <DockMenu store={store} id={id} />
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
  onOpenBottom,
  onOpenRight,
}: {
  windowId: string;
  children?: ReactNode;
  onOpenBottom: () => void;
  onOpenRight: () => void;
}) {
  const store = use(DockContext);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- connects global panel controls to the active thread's existing resource commands
  useLayoutEffect(() => {
    store?.setOpeners({ bottom: onOpenBottom, right: onOpenRight });
    return () => store?.setOpeners({});
  }, [store, onOpenBottom, onOpenRight]);
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
    const snapshot = store.getSnapshot();
    return (
      !snapshot.layout.hidden[panel] &&
      workspaceGroups(snapshot.layout, Object.values(snapshot.windows), panel).length > 0
    );
  });
  return store ? { visible, toggle: () => store.togglePanel(panel) } : null;
}
export function WorkspaceRoot({
  children,
  controls,
}: {
  children: ReactNode;
  controls?: ReactNode;
}) {
  const wide = useMediaQuery("(min-width: 768px)");
  const [store] = useState(createDockStore);
  if (!wide && !isElectron)
    return (
      <>
        {controls}
        {children}
      </>
    );
  return (
    <DockContext value={store}>
      <DockFrame store={store} controls={controls}>
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
    bottom: "Bottom panel",
    floating: "Floating panel",
  };
}
function DockFrame({
  store,
  children,
  controls,
}: {
  store: DockStore;
  children: ReactNode;
  controls?: ReactNode;
}) {
  const panelLabels = workspacePanelLabel();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { layout } = snapshot;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync, react/exhaustive-effect-dependencies -- repositions native browser layers after docking changes that do not resize their content
  useLayoutEffect(() => notifyWorkspaceLayout(), [layout]);
  const windows = Object.values(snapshot.windows);
  const chatPresent = windows.some((window) => window.available && window.id.startsWith("chat:"));
  const shown = windows.filter((window) => window.id !== "route" || !chatPresent);
  const groups = Object.fromEntries(
    workspacePanels.map((panel) => [panel, workspaceGroups(layout, shown, panel)]),
  ) as Record<WorkspacePanel, ReturnType<typeof workspaceGroups>>;
  const panelVisible = (panel: WorkspacePanel) =>
    !layout.hidden[panel] && (panel === "main" || groups[panel].length > 0);
  const left = panelVisible("left"),
    right = panelVisible("right"),
    bottom = panelVisible("bottom"),
    floatingVisible = panelVisible("floating");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to document Escape key while floating modal is visible
  useEffect(() => {
    if (!floatingVisible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
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
      const active = group.active === id;
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
  const panel = (key: Exclude<WorkspacePanel, "floating">) => {
    if (groups[key].length === 0 && key !== "main") return null;
    return (
      <section
        key={key}
        hidden={!panelVisible(key)}
        inert={!panelVisible(key)}
        aria-label={panelLabels[key]}
        data-workspace-panel={key}
        data-workspace-group={key === "main" && groups.main.length === 0 ? "main" : undefined}
        data-workspace-owner={key === "main" && groups.main.length === 0 ? "main" : undefined}
        className={cn(
          "relative flex min-h-0 min-w-0 overflow-visible",
          key === "main" &&
            groups.main.length === 0 &&
            "workspace-window-card workspace-window-surface-main",
        )}
        style={{ gridArea: key }}
      >
        <div
          className={cn(
            "relative flex min-h-0 min-w-0 flex-1 gap-(--workspace-seam)",
            layout.vertical[key] && "flex-col",
          )}
        >
          {groups[key].map((group) => (
            <div
              key={group.id}
              data-workspace-group={group.id}
              data-workspace-owner={key}
              className={cn(
                "workspace-window-card relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
                key === "left"
                  ? "workspace-window-surface-left"
                  : key === "right"
                    ? "workspace-window-surface-right"
                    : "workspace-window-surface-main",
              )}
            >
              {renderGroupWindows(group)}
            </div>
          ))}
        </div>
        {key === "right" ? (
          <div
            data-workspace-panel-actions="right"
            className="absolute top-1 right-8 z-40 rounded-md bg-background/95 opacity-0 hover:opacity-100 focus-within:opacity-100 [&:has([data-popup-open])]:opacity-100"
          >
            <PortalMount node={store.getActionsContainer("panel:right")} />
          </div>
        ) : null}
        {key === "left" || key === "right" || key === "bottom" ? (
          <PanelResize store={store} panel={key} />
        ) : null}
      </section>
    );
  };
  const headerWindows = workspacePanels.flatMap((key) => {
    const members = groups[key].flatMap((group) => group.windows);
    if (!panelVisible(key) || (members.length < 2 && key !== "right" && key !== "bottom"))
      return [];
    return members.map((id) => ({ id, group: layout.placements[id]!.group, key }));
  });
  const renderTabs = (tabs: typeof headerWindows) =>
    tabs.map(({ id, group, key }, index) => (
      <button
        key={id}
        role="tab"
        aria-selected={
          layout.active[group] === id || groups[key].some((value) => value.active === id)
        }
        aria-label={snapshot.windows[id]!.title}
        draggable={!snapshot.windows[id]!.fixed}
        onDragStart={(event) => event.dataTransfer.setData("application/x-t3-window", id)}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("application/x-t3-window")) event.preventDefault();
        }}
        onDrop={(event) => {
          const source = event.dataTransfer.getData("application/x-t3-window");
          if (source) {
            event.preventDefault();
            store.move(source, { panel: key, group });
          }
        }}
        onClick={() => store.activate(id)}
        onAuxClick={(event) => {
          if (event.button === 1) store.close(id);
        }}
        className={cn(
          "workspace-window-label group flex h-6 max-w-48 shrink-0 items-center gap-2 rounded px-2 text-muted-foreground transition-colors hover:bg-foreground/6 hover:text-foreground",
          groups[key].some((value) => value.active === id) &&
            "bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground",
          index > 0 && tabs[index - 1]?.key !== key && "ml-2",
        )}
      >
        {snapshot.windows[id]!.icon ? (
          <span aria-hidden className="relative flex shrink-0 items-center">
            {snapshot.windows[id]!.icon}
          </span>
        ) : null}
        <span className="truncate">{snapshot.windows[id]!.title}</span>
        {snapshot.windows[id]!.fixed || !snapshot.windows[id]!.closable ? null : (
          <span
            role="button"
            aria-label={`Close ${snapshot.windows[id]!.title}`}
            tabIndex={0}
            className="opacity-0 group-hover:opacity-100 focus:opacity-100"
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
    ));
  const leftTabs = headerWindows.filter((window) => window.key === "left");
  const singleMain = groups.main.flatMap((group) => group.windows);
  const mainWindow = singleMain.length === 1 ? snapshot.windows[singleMain[0]!] : undefined;
  const renderPanelToggle = (key: "left" | "bottom" | "right") => {
    const [Icon, command] = (
      {
        left: [PanelLeftIcon, "sidebar.toggle"],
        bottom: [PanelBottomIcon, "terminal.toggle"],
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
              className="group/panel-toggle relative grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors duration-150 ease-(--ease-drawer) hover:bg-accent hover:text-foreground aria-pressed:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2 motion-reduce:duration-0 in-data-[panel-animations=false]:duration-0 pointer-coarse:after:absolute pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 [-webkit-app-region:no-drag]"
              aria-label={`Toggle ${panelLabels[key]}`}
              aria-pressed={panelVisible(key)}
              onClick={() => store.togglePanel(key)}
            />
          }
        >
          <Icon className="size-3.5" aria-hidden>
            <path
              d={
                key === "bottom"
                  ? "m9 7 3 3 3-3"
                  : key === "left"
                    ? "m16 15-3-3 3-3"
                    : "m8 9 3 3-3 3"
              }
              className={cn(
                "opacity-0 transition-[opacity,translate] duration-150 ease-(--ease-drawer) group-aria-pressed/panel-toggle:translate-x-0 group-aria-pressed/panel-toggle:translate-y-0 group-aria-pressed/panel-toggle:opacity-100 motion-reduce:duration-0 in-data-[panel-animations=false]:duration-0",
                key === "bottom"
                  ? "-translate-y-1"
                  : key === "left"
                    ? "translate-x-1"
                    : "-translate-x-1",
              )}
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
  const panels = (["left", "main", "right", "bottom"] as const).map(panel);
  const floatingTabs = groups.floating.flatMap((group) =>
    group.windows.map((id) => ({ id, group: group.id, key: "floating" as const })),
  );
  const activeFloatingId =
    groups.floating.find((group) => group.active)?.active ?? floatingTabs[0]?.id;
  const activeFloatingWindow = activeFloatingId ? snapshot.windows[activeFloatingId] : undefined;
  const dockTargetPanel =
    activeFloatingWindow && activeFloatingWindow.defaultPanel !== "floating"
      ? activeFloatingWindow.defaultPanel
      : "right";
  const floatingOverlay =
    groups.floating.length > 0 ? (
      <div
        data-workspace-floating-overlay=""
        hidden={!floatingVisible}
        inert={!floatingVisible}
        className="absolute inset-0 z-40 flex items-center justify-center p-5 transition-opacity duration-150 sm:p-8 [-webkit-app-region:no-drag]"
      >
        <div
          aria-hidden
          data-workspace-floating-backdrop=""
          className="dialog-backdrop absolute inset-0"
          onClick={() => store.hidePanel("floating")}
        />
        <section
          aria-label={panelLabels.floating}
          data-workspace-panel="floating"
          className="workspace-window-surface-floating relative z-10 flex h-full max-h-[820px] w-full max-w-[1060px] min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border"
        >
          <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3.5">
            <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
              {floatingTabs.length > 1 ? (
                renderTabs(floatingTabs)
              ) : activeFloatingWindow ? (
                <div className="flex min-w-0 items-center gap-2 text-foreground">
                  {activeFloatingWindow.icon ? (
                    <span aria-hidden className="flex shrink-0 items-center text-muted-foreground">
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
              {activeFloatingWindow && !activeFloatingWindow.fixed ? (
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
            </div>
          </div>
          <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
            {groups.floating.map((group) => (
              <div
                key={group.id}
                data-workspace-group={group.id}
                data-workspace-owner="floating"
                className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
              >
                {renderGroupWindows(group)}
              </div>
            ))}
          </div>
        </section>
      </div>
    ) : null;
  return (
    <div
      className="relative flex h-full min-h-0 w-full flex-1 flex-col bg-(--workspace-board) [--workspace-board:color-mix(in_oklab,var(--background),var(--foreground)_4%)] [--workspace-seam:6px] [--workspace-topbar-height:34px]"
      data-workspace-dock=""
    >
      <header
        className="drag-region relative grid h-[34px] min-h-[34px] shrink-0 items-center gap-(--workspace-seam) px-(--workspace-seam) wco:pr-(--workspace-native-controls-inset)"
        style={{
          gridTemplateColumns: `${left ? `${layout.sizes.left}px` : "max-content"} minmax(0,1fr)${right ? ` ${layout.sizes.right}px` : ""}`,
        }}
        data-workspace-titlebar=""
      >
        <div
          className="flex h-full min-w-0 items-center gap-3 overflow-hidden pr-3 pl-(--workspace-controls-left)"
          data-workspace-titlebar-leading=""
        >
          {renderPanelToggle("left")}
          {leftTabs.length > 0 ? (
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
              {renderTabs(leftTabs)}
            </div>
          ) : null}
        </div>
        <div
          className={cn(
            "flex h-full min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]",
            !right && "pr-16 workspace-titlebar-tabs-fade",
          )}
          data-workspace-titlebar-content=""
        >
          {renderTabs(headerWindows.filter((window) => window.key === "main"))}

          {mainWindow ? (
            mainWindow.hasTitlebar ? (
              <PortalMount node={mainWindow.titleContainer} className="min-w-0" />
            ) : mainWindow.id === "route" && mainWindow.title === "T3 Code" ? null : (
              <span className="workspace-window-label truncate">{mainWindow.title}</span>
            )
          ) : null}
          {renderTabs(headerWindows.filter((window) => window.key === "bottom"))}
        </div>
        {right ? (
          <div
            className="flex h-full min-w-0 items-center overflow-x-auto pr-16 workspace-titlebar-tabs-fade [scrollbar-width:none]"
            data-workspace-titlebar-right=""
          >
            {renderTabs(headerWindows.filter((window) => window.key === "right"))}
          </div>
        ) : null}
        <div className="absolute right-2.5 top-0 flex h-full shrink-0 items-center gap-1">
          {groups.floating.length > 0 ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="group/panel-toggle relative grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors duration-150 ease-(--ease-drawer) hover:bg-accent hover:text-foreground aria-pressed:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2 motion-reduce:duration-0 in-data-[panel-animations=false]:duration-0 pointer-coarse:after:absolute pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 [-webkit-app-region:no-drag]"
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
          {renderPanelToggle("bottom")}
          {renderPanelToggle("right")}
        </div>
      </header>
      {controls}
      <div
        ref={(node) => store.setBody(node)}
        className="relative grid min-h-0 flex-1 gap-(--workspace-seam) overflow-hidden px-(--workspace-seam) pb-(--workspace-seam)"
        style={{
          gridTemplateColumns: [
            left ? `${layout.sizes.left}px` : null,
            "minmax(0,1fr)",
            right ? `${layout.sizes.right}px` : null,
          ]
            .filter(Boolean)
            .join(" "),
          gridTemplateRows: bottom ? `minmax(0,1fr) ${layout.sizes.bottom}px` : "minmax(0,1fr)",
          gridTemplateAreas: `"${left ? "left " : ""}main${right ? " right" : ""}"${bottom ? ` "${left ? "left " : ""}bottom${right ? " right" : ""}"` : ""}`,
        }}
      >
        <div className="pointer-events-none invisible absolute inset-0" aria-hidden inert>
          {children}
        </div>
        {panels}
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
        <div hidden inert>
          {windows
            .filter((window) => !mounted.has(window.id) && window.id !== "route")
            .map((window) => (
              <PortalMount key={window.id} node={window.container} />
            ))}
          {windows
            .filter((window) => window.id !== mainWindow?.id || !window.hasTitlebar)
            .map((window) => (
              <PortalMount key={window.id} node={window.titleContainer} />
            ))}
        </div>
      </div>
      {floatingOverlay}
    </div>
  );
}
function DockMenu({ store, id }: { store: DockStore; id: string }) {
  const panelLabels = workspacePanelLabel();
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

function PanelResize({ store, panel }: { store: DockStore; panel: "left" | "right" | "bottom" }) {
  const panelLabels = workspacePanelLabel();
  return (
    <div
      role="separator"
      aria-label={`Resize ${panelLabels[panel]}`}
      aria-orientation={panel === "bottom" ? "horizontal" : "vertical"}
      className={cn(
        "group/resize absolute z-20 flex touch-none items-center justify-center before:absolute before:-inset-1",
        panel === "bottom"
          ? "inset-x-0 -top-(--workspace-seam) h-(--workspace-seam) cursor-row-resize"
          : "inset-y-0 w-(--workspace-seam) cursor-col-resize",
        panel === "left"
          ? "-right-(--workspace-seam)"
          : panel === "right"
            ? "-left-(--workspace-seam)"
            : "",
      )}
      onPointerDown={(event) => {
        event.preventDefault();
        const node = event.currentTarget;
        node.setPointerCapture(event.pointerId);
        const initial = store.getSnapshot().layout.sizes[panel];
        const start = panel === "bottom" ? event.clientY : event.clientX;
        const move = (next: PointerEvent) => {
          const delta = (panel === "bottom" ? next.clientY : next.clientX) - start;
          const value = Math.max(
            panel === "bottom" ? 120 : 180,
            Math.min(600, initial + (panel === "left" ? delta : -delta)),
          );
          const current = store.getSnapshot().layout;
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
        className={cn(
          "pointer-events-none shrink-0 rounded-full bg-foreground/40 opacity-0 group-hover/resize:opacity-100 group-active/resize:opacity-100",
          panel === "bottom" ? "h-[2px] w-8" : "h-8 w-[2px]",
        )}
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
            aria-label={`Drag ${title}`}
            className="absolute top-0 left-1/2 z-20 grid h-3 w-16 -translate-x-1/2 cursor-grab touch-none place-items-center rounded-b-lg opacity-0 hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing [-webkit-app-region:no-drag] pointer-coarse:opacity-75"
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
                        : py > origin.height - 24
                          ? "bottom"
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
                  const width =
                      dockPanel === "bottom" ? origin.width : snapshot.layout.sizes[dockPanel],
                    height = dockPanel === "bottom" ? snapshot.layout.sizes.bottom : origin.height;
                  Object.assign(guide.style, {
                    left: `${dockPanel === "right" ? Math.max(0, origin.width - width) : 0}px`,
                    top: `${dockPanel === "bottom" ? Math.max(0, origin.height - height) : 0}px`,
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
