import "~/index.css";
import { createRef, useEffect, useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { act, render, stubGlobal } from "../../../test/render";
import { BrowserSurfaceSlot } from "../../browser/BrowserSurfaceSlot";
import { useBrowserSurfaceStore } from "../../browser/browserSurfaceStore";
import { __setClientSettingsForTests, getClientSettings } from "../../hooks/useSettings";
import { syncDocumentElectronPlatformClasses } from "../../lib/windowControlsOverlay";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { ThreadDetailsCard } from "../chat/ThreadDetailsCard";
import { PopoverCreateHandle } from "../ui/popover";
import { Sidebar, SidebarProvider } from "../ui/sidebar";
import {
  WorkspaceActions,
  WorkspacePanelActions,
  WorkspaceRoot,
  WorkspaceWindow,
  useWorkspacePanel,
  useWorkspaceWindowToggle,
} from "./WorkspaceDock";

vi.mock(import("../../env"), async (original) => ({
  ...(await original()),
  isElectron: true,
}));

function isolatedLayout() {
  const key = "t3code:workspace-layout:v1",
    saved = localStorage.getItem(key);
  localStorage.removeItem(key);
  return {
    [Symbol.dispose]() {
      if (saved === null) localStorage.removeItem(key);
      else localStorage.setItem(key, saved);
    },
  };
}
function Content({ mount }: { mount: () => () => void }) {
  useEffect(mount, [mount]);
  return (
    <div className="p-8">
      <input aria-label="draft" defaultValue="keep me" />
      <iframe sandbox="allow-same-origin" title="embedded browser" srcDoc="<p>ready</p>" />
    </div>
  );
}
it("keeps live window content when moving, splitting, hiding and restoring it, with tabs inside their own panels", async () => {
  await page.viewport(1280, 800);
  using _layout = isolatedLayout();
  const dispose = vi.fn(),
    mount = vi.fn(() => dispose);
  await using screen = await render(
    <div className="h-screen w-screen">
      <WorkspaceRoot>
        <WorkspaceWindow id="chat:test" title="Conversation" panel="main" selected>
          <Content mount={mount} />
        </WorkspaceWindow>
        <WorkspaceActions windowId="chat:test" onOpenRight={() => {}}>
          <button>Conversation details</button>
        </WorkspaceActions>
        <WorkspaceWindow id="file" title="README" panel="right">
          <p>File content</p>
        </WorkspaceWindow>
      </WorkspaceRoot>
    </div>,
  );
  await expect.element(screen.getByRole("textbox", { name: "draft" })).toBeVisible();
  const input = screen.getByRole("textbox", { name: "draft" }).element();
  const frame = screen.container.querySelector("iframe")!;
  await vi.waitFor(() => expect(frame.contentDocument?.body.textContent).toBe("ready"));
  const frameDocument = frame.contentDocument;
  const chatControls = screen
    .getByRole("button", { name: "Conversation details" })
    .element()
    .closest("[data-workspace-window-controls]")!;
  expect(
    chatControls.closest("[data-workspace-window]")?.getAttribute("data-workspace-window"),
  ).toBe("chat:test");
  expect(
    screen.container.querySelector("[data-workspace-controls] [data-workspace-window-controls]"),
  ).toBeNull();
  await userEvent.fill(screen.getByRole("textbox", { name: "draft" }), "unsent draft");
  await expect.element(screen.getByRole("tab", { name: "README", exact: true })).toBeVisible();
  await userEvent.click(screen.getByRole("textbox", { name: "draft" }));
  await userEvent.click(screen.getByText("File content", { exact: true }));
  await userEvent.click(
    page
      .elementLocator(input.closest("[data-workspace-window]")!)
      .getByRole("button", { name: "Window actions" }),
  );
  await userEvent.click(page.getByRole("menuitem", { name: "Move to Right panel" }));
  await expect
    .element(screen.getByRole("tab", { name: "Conversation", exact: true }))
    .toBeVisible();
  expect(input.closest("[data-workspace-panel]")?.getAttribute("data-workspace-panel")).toBe(
    "right",
  );
  expect(
    screen.container.querySelectorAll('[data-workspace-panel="right"] [role="tab"]'),
  ).toHaveLength(2);
  expect(input).toBe(screen.getByRole("textbox", { name: "draft" }).element());
  expect(chatControls.closest("[data-workspace-window]")).toBe(
    input.closest("[data-workspace-window]"),
  );
  expect(mount).toHaveBeenCalledTimes(1);
  expect(dispose).not.toHaveBeenCalled();
  expect(frame.contentDocument).toBe(frameDocument);
  await userEvent.click(
    page
      .elementLocator(input.closest("[data-workspace-panel]")!)
      .getByRole("button", { name: "Window actions" }),
  );
  await userEvent.click(page.getByRole("menuitem", { name: "Split vertically" }));
  await expect.element(screen.getByText("File content", { exact: true })).toBeVisible();
  expect(
    screen.container.querySelectorAll('[data-workspace-panel="right"] [data-workspace-group]'),
  ).toHaveLength(2);
  await userEvent.click(screen.getByRole("button", { name: "Toggle Right panel" }));
  expect(input.checkVisibility()).toBe(false);
  expect(screen.getByRole("tab", { name: "Conversation", exact: true }).all()).toHaveLength(0);
  await expect
    .element(screen.getByRole("button", { name: "Toggle Right panel" }))
    .toHaveAttribute("aria-pressed", "false");
  await userEvent.click(screen.getByRole("button", { name: "Toggle Right panel" }));
  await expect.element(screen.getByRole("textbox", { name: "draft" })).toHaveValue("unsent draft");
  await expect
    .element(screen.getByRole("button", { name: "Toggle Right panel" }))
    .toHaveAttribute("aria-pressed", "true");
  expect(
    screen.container.querySelectorAll("[data-workspace-controls] button[aria-pressed]"),
  ).toHaveLength(2);
  await userEvent.click(
    page
      .elementLocator(input.closest("[data-workspace-window]")!)
      .getByRole("button", { name: "Window actions" }),
  );
  await userEvent.click(page.getByRole("menuitem", { name: "Move to Main panel" }));
  await vi.waitFor(() =>
    expect(input.closest("[data-workspace-panel]")?.getAttribute("data-workspace-panel")).toBe(
      "main",
    ),
  );
  expect(mount).toHaveBeenCalledTimes(1);
  expect(dispose).not.toHaveBeenCalled();
  expect(frame.contentDocument).toBe(frameDocument);
  expect(screen.container.querySelector("[data-workspace-titlebar]")).toBeNull();
});
it("cancels a handle drag with Escape and floats a window without remounting its input", async () => {
  await page.viewport(1280, 800);
  using _layout = isolatedLayout();
  await using screen = await render(
    <div className="h-screen w-screen">
      <WorkspaceRoot>
        <WorkspaceWindow id="chat:test" title="Conversation" panel="main" selected>
          <div className="p-8">
            <input aria-label="draft" defaultValue="preserved" />
            <BrowserSurfaceSlot tabId="workspace-drag-test" visible className="h-20 w-full" />
          </div>
        </WorkspaceWindow>
      </WorkspaceRoot>
    </div>,
  );
  await expect.element(screen.getByRole("textbox", { name: "draft" })).toBeVisible();
  const input = screen.getByRole("textbox", { name: "draft" }).element();
  // Synthetic pointer events have no active browser pointer to capture.
  using _capture = vi
    .spyOn(HTMLElement.prototype, "setPointerCapture")
    .mockImplementation(() => {});
  const pointer = (type: string, x: number, y: number, altKey = false) =>
    new PointerEvent(type, {
      bubbles: true,
      pointerId: 1,
      button: 0,
      clientX: x,
      clientY: y,
      altKey,
    });
  const drag = async () => {
    const handle = screen.getByRole("button", { name: "Drag Conversation" }).element(),
      bounds = handle.getBoundingClientRect();
    await act(() => {
      handle.dispatchEvent(pointer("pointerdown", bounds.x + 30, bounds.y + 10));
      document.dispatchEvent(pointer("pointermove", 400, 300, true));
    });
  };
  await drag();
  const slot = screen.container.querySelector('[data-browser-surface-slot="workspace-drag-test"]')!;
  expect(useBrowserSurfaceStore.getState().byTabId["workspace-drag-test"]?.rect?.x).toBe(
    Math.round(slot.getBoundingClientRect().x),
  );
  expect(useBrowserSurfaceStore.getState().byTabId["workspace-drag-test"]?.zIndex).toBe(130);
  await act(() =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(input.closest("[data-workspace-panel]")?.getAttribute("data-workspace-panel")).toBe(
    "main",
  );
  input.focus();
  await drag();
  await act(() => document.dispatchEvent(pointer("pointerup", 400, 300, true)));
  await vi.waitFor(() =>
    expect(input.closest("[data-workspace-panel]")?.getAttribute("data-workspace-panel")).toBe(
      "floating",
    ),
  );
  expect(input).toBe(screen.getByRole("textbox", { name: "draft" }).element());
  await expect.element(screen.getByRole("textbox", { name: "draft" })).toHaveValue("preserved");
  expect(document.activeElement).toBe(input);
  expect(useBrowserSurfaceStore.getState().byTabId["workspace-drag-test"]?.rect?.x).toBe(
    Math.round(slot.getBoundingClientRect().x),
  );
  expect(useBrowserSurfaceStore.getState().byTabId["workspace-drag-test"]?.zIndex).toBe(130);
  await drag();
  await act(() => {
    document.dispatchEvent(pointer("pointermove", 1050, 350));
    document.dispatchEvent(pointer("pointerup", 1050, 350));
  });
  await vi.waitFor(() =>
    expect(input.closest("[data-workspace-panel]")?.getAttribute("data-workspace-panel")).toBe(
      "main",
    ),
  );
  expect(input).toBe(screen.getByRole("textbox", { name: "draft" }).element());
});

it("restores a hidden panel without an initially selected resource reopening it", async () => {
  await page.viewport(1280, 800);
  using _layout = isolatedLayout();
  localStorage.setItem(
    "t3code:workspace-layout:v1",
    JSON.stringify({
      placements: {
        file: { panel: "right", group: "right" },
        threads: { panel: "floating", group: "floating" },
      },
      hidden: { right: true },
      active: { right: "file" },
    }),
  );
  await using screen = await render(
    <div className="h-screen w-screen">
      <WorkspaceRoot>
        <WorkspaceWindow id="threads" title="Threads" panel="left" fixed>
          <p>Pinned threads</p>
        </WorkspaceWindow>
        <WorkspacePanelActions>
          <button>Add resource</button>
        </WorkspacePanelActions>
        <WorkspaceWindow id="file" title="README" panel="right" selected>
          <p>Saved file</p>
        </WorkspaceWindow>
      </WorkspaceRoot>
    </div>,
  );
  const controls = screen.container.querySelector("[data-workspace-controls]")!;
  expect(controls.textContent).not.toContain("T3 Code");
  expect(
    screen
      .getByRole("button", { name: "Toggle Left panel" })
      .element()
      .closest("[data-workspace-controls-leading]"),
  ).not.toBeNull();
  expect(screen.getByRole("button", { name: "Toggle Bottom panel" }).all()).toHaveLength(0);
  const sidebar = screen.getByText("Pinned threads").element().closest("[data-workspace-window]")!;
  expect(sidebar.closest("[data-workspace-panel]")?.getAttribute("data-workspace-panel")).toBe(
    "left",
  );
  expect(sidebar.querySelector("[data-workspace-window-controls]")).toBeNull();
  expect(sidebar.querySelector("button")).toBeNull();
  expect(
    screen.container.querySelector('[data-workspace-controls] [aria-haspopup="menu"]'),
  ).toBeNull();
  await expect
    .element(screen.getByRole("button", { name: "Toggle Right panel" }))
    .toHaveAttribute("aria-pressed", "false");
  await userEvent.click(screen.getByRole("button", { name: "Toggle Right panel" }));
  await expect.element(screen.getByText("Saved file", { exact: true })).toBeVisible();
  const addButton = screen.getByRole("button", { name: "Add resource" }).element();
  expect(addButton.closest("[data-workspace-panel]")?.getAttribute("data-workspace-panel")).toBe(
    "right",
  );
  // Window actions menu button (`...`) sits right after `+` in the right panel header toolbar.
  const rightActions = screen.container.querySelector('[data-workspace-panel-actions="right"]')!;
  const windowActionsButton = rightActions.querySelector('button[aria-label="Window actions"]')!;
  expect(windowActionsButton).not.toBeNull();
  expect(
    Boolean(
      addButton.compareDocumentPosition(windowActionsButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ),
  ).toBe(true);
});

function TerminalToggle({ right = false, onOpen }: { right?: boolean; onOpen?: () => void }) {
  const toggle = useWorkspaceWindowToggle();
  return (
    <button
      onClick={() => {
        if (!toggle("drawer:test", right ? "right" : undefined)) onOpen?.();
      }}
    >
      Toggle terminal window
    </button>
  );
}
it.each(["panel", "window"])(
  "preserves a closed terminal after switching threads (%s)",
  async (mode) => {
    await page.viewport(1280, 800);
    using _layout = isolatedLayout();
    const ui = (active: boolean) => (
      <div className="h-screen w-screen">
        <WorkspaceRoot>
          <WorkspaceWindow id="chat:test" title="Conversation" panel="main">
            <TerminalToggle />
          </WorkspaceWindow>
          <WorkspaceWindow
            id="drawer:test"
            title="Terminal"
            panel="right"
            available={active}
            selected
            activation={true}
          >
            <input aria-label="terminal draft" defaultValue="preserved" />
          </WorkspaceWindow>
        </WorkspaceRoot>
      </div>
    );
    await using screen = await render(ui(true));
    await expect.element(screen.getByRole("textbox", { name: "terminal draft" })).toBeVisible();
    const input = screen.getByRole("textbox", { name: "terminal draft" }).element();
    const control = () =>
      mode === "panel"
        ? screen.getByRole("button", { name: "Toggle Right panel" })
        : screen.getByRole("button", { name: "Toggle terminal window" });
    await userEvent.click(control());
    expect(input.closest('[data-workspace-panel="right"]')?.hasAttribute("inert")).toBe(true);
    await screen.rerender(ui(false));
    await screen.rerender(ui(true));
    expect(input.checkVisibility()).toBe(false);
    await userEvent.click(control());
    await expect
      .element(screen.getByRole("textbox", { name: "terminal draft" }))
      .toHaveValue("preserved");
    await expect.element(screen.getByRole("textbox", { name: "terminal draft" })).toBeVisible();
  },
);

function ActiveTerminal({ initiallyOpen = false }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <>
      <WorkspaceWindow id="chat:current" title="Conversation" panel="main">
        <TerminalToggle right onOpen={() => setOpen(true)} />
      </WorkspaceWindow>
      <WorkspaceActions windowId="chat:current" onOpenRight={() => setOpen(true)}>
        <span />
      </WorkspaceActions>
      {open && (
        <WorkspaceWindow id="drawer:test" title="Terminal" panel="right" selected>
          <input aria-label="active terminal" defaultValue="preserved" />
        </WorkspaceWindow>
      )}
    </>
  );
}
it("opens the active thread's right panel instead of an unavailable thread's terminal", async () => {
  await page.viewport(1280, 800);
  using _layout = isolatedLayout();
  await using screen = await render(
    <div className="h-screen w-screen">
      <WorkspaceRoot>
        <WorkspaceWindow id="drawer:other" title="Other terminal" panel="right" available={false}>
          <p>Other shell</p>
        </WorkspaceWindow>
        <ActiveTerminal />
      </WorkspaceRoot>
    </div>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Toggle Right panel" }));
  await expect.element(screen.getByRole("textbox", { name: "active terminal" })).toBeVisible();
});

it("preserves desktop docking across the narrow breakpoint", async () => {
  await page.viewport(1000, 800);
  using _layout = isolatedLayout();
  using _bridge = stubGlobal("desktopBridge", {});
  const dispose = vi.fn(),
    mount = vi.fn(() => dispose);
  await using screen = await render(
    <div className="h-screen w-screen">
      <WorkspaceRoot>
        <WorkspaceWindow id="chat:zoom" title="Conversation" panel="main">
          <Content mount={mount} />
        </WorkspaceWindow>
        <WorkspaceWindow id="terminal:zoom" title="Terminal" panel="right">
          <p>Zoom terminal</p>
        </WorkspaceWindow>
      </WorkspaceRoot>
    </div>,
  );
  await expect.element(screen.getByRole("textbox", { name: "draft" })).toBeVisible();
  const input = screen.getByRole("textbox", { name: "draft" }).element();
  await userEvent.fill(screen.getByRole("textbox", { name: "draft" }), "unsent zoom draft");
  await page.viewport(700, 600);
  await expect.element(screen.getByRole("button", { name: "Toggle Right panel" })).toBeVisible();
  expect(mount).toHaveBeenCalledTimes(1);
  expect(dispose).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "draft" }).element()).toBe(input);
  await page.viewport(1000, 800);
  await expect
    .element(screen.getByRole("textbox", { name: "draft" }))
    .toHaveValue("unsent zoom draft");
  expect(mount).toHaveBeenCalledTimes(1);
});

it.each([true, false])(
  "returns a floated terminal to the right panel when explicitly toggling it (mounted: %s)",
  async (initiallyOpen) => {
    await page.viewport(1280, 800);
    using _layout = isolatedLayout();
    localStorage.setItem(
      "t3code:workspace-layout:v1",
      JSON.stringify({
        placements: { "drawer:test": { panel: "floating", group: "floating" } },
        hidden: { right: true, floating: true },
      }),
    );
    await using screen = await render(
      <div className="h-screen w-screen">
        <WorkspaceRoot>
          <ActiveTerminal initiallyOpen={initiallyOpen} />
        </WorkspaceRoot>
      </div>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Toggle terminal window" }));
    await expect.element(screen.getByRole("textbox", { name: "active terminal" })).toBeVisible();
    expect(
      screen
        .getByRole("textbox", { name: "active terminal" })
        .element()
        .closest("[data-workspace-panel]")
        ?.getAttribute("data-workspace-panel"),
    ).toBe("right");
  },
);

it("keeps side panels on the shared background and docks Details beside the raised conversation", async () => {
  await page.viewport(1280, 800);
  using _layout = isolatedLayout();
  const cleanupPlatform = syncDocumentElectronPlatformClasses("MacIntel");
  using _platform = { [Symbol.dispose]: cleanupPlatform };
  const handle = PopoverCreateHandle();
  const anchor = createRef<HTMLElement>();
  const ui = (fullscreen: boolean, filesOpen: boolean) => (
    <SidebarProvider
      className="h-screen w-screen"
      data-window-fullscreen={fullscreen ? "true" : undefined}
    >
      <WorkspaceRoot>
        <WorkspaceWindow id="threads" fixed title="Threads" panel="left">
          <Sidebar collapsible="none" className="w-full">
            <p>Sidebar navigation</p>
          </Sidebar>
        </WorkspaceWindow>
        <WorkspaceWindow id="chat:glass" title="Conversation" panel="main" selected>
          <div className="flex-1 bg-background">Solid conversation</div>
        </WorkspaceWindow>
        <ThreadDetailsCard
          threadRef={{ environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("glass") }}
          anchor={anchor}
          handle={handle}
          contentKey="usage"
        >
          {() => <p>Inspector details</p>}
        </ThreadDetailsCard>
        {filesOpen && (
          <WorkspaceWindow id="surface:glass:files" title="Files" panel="right" selected>
            <p>Workspace files</p>
          </WorkspaceWindow>
        )}
      </WorkspaceRoot>
    </SidebarProvider>
  );
  await using screen = await render(ui(false, false));
  const inspector = screen.getByText("Inspector details");
  await expect.element(inspector).toBeVisible();
  await userEvent.tab();
  await expect.element(screen.getByRole("button", { name: "Toggle Left panel" })).toHaveFocus();
  expect(
    inspector.element().closest("[data-workspace-panel]")?.getAttribute("data-workspace-panel"),
  ).toBe("right");
  const rightToggle = screen.getByRole("button", { name: "Toggle Right panel" });
  await userEvent.click(rightToggle);
  await expect.element(inspector).not.toBeVisible();
  await userEvent.click(rightToggle);
  await expect.element(inspector).toBeVisible();
  await screen.rerender(ui(false, true));
  await expect.element(screen.getByText("Solid conversation", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("Workspace files", { exact: true })).toBeVisible();
  await expect.element(screen.getByRole("tab", { name: "Details", exact: true })).toBeVisible();
  expect(screen.container.querySelector('[aria-label="Close Details"]')).toBeNull();
  expect(screen.container.querySelector('[aria-label="Close Files"]')).not.toBeNull();
  const dock = screen.container.querySelector<HTMLElement>("[data-workspace-dock]")!;
  const controls = screen.container.querySelector<HTMLElement>("[data-workspace-controls]")!;
  const rightToggles = screen
    .getByRole("button", { name: "Toggle Right panel" })
    .element().parentElement!;
  const mainPanel = screen.container.querySelector<HTMLElement>('[data-workspace-panel="main"]')!;
  const leftGroup = screen.container.querySelector<HTMLElement>(
    '[data-workspace-panel="left"] [data-workspace-group]',
  )!;
  const leftWindowContainer = leftGroup.querySelector<HTMLElement>(
    "[data-workspace-window-container]",
  )!;
  const leftSidebar = leftGroup.querySelector<HTMLElement>('[data-slot="sidebar"]')!;
  const mainGroup = screen.container.querySelector<HTMLElement>(
    '[data-workspace-panel="main"] [data-workspace-group]',
  )!;
  const mainWindowContainer = mainGroup.querySelector<HTMLElement>(
    "[data-workspace-window-container]",
  )!;
  const rightGroup = screen.container.querySelector<HTMLElement>(
    '[data-workspace-panel="right"] [data-workspace-group]',
  )!;
  const rightWindowContainer = rightGroup.querySelector<HTMLElement>(
    "[data-workspace-window-container]",
  )!;

  const alphaOf = (element: Element) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = getComputedStyle(element).backgroundColor;
    ctx.fillRect(0, 0, 1, 1);
    return ctx.getImageData(0, 0, 1, 1).data[3]!;
  };

  expect(document.documentElement.classList.contains("electron-macos")).toBe(true);
  expect(getComputedStyle(controls).position).toBe("absolute");
  const rightHeading = screen.container.querySelector('[data-workspace-panel-heading="right"]')!;
  expect(rightHeading.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
  for (const toggle of controls.querySelectorAll("button")) {
    expect(getComputedStyle(toggle).getPropertyValue("app-region")).toBe("no-drag");
  }
  expect(mainPanel.getBoundingClientRect().top - dock.getBoundingClientRect().top).toBe(6);
  expect(alphaOf(document.body)).toBe(0);
  expect(alphaOf(mainPanel)).toBe(0);
  expect(alphaOf(controls)).toBe(0);
  expect(alphaOf(rightToggles)).toBe(0);

  // Inner portal containers and sidebar wrappers never paint an opaque fill over window cards or split seams.
  expect(alphaOf(leftWindowContainer)).toBe(0);
  expect(alphaOf(leftSidebar)).toBe(0);
  expect(alphaOf(rightWindowContainer)).toBe(0);
  expect(alphaOf(mainGroup)).toBe(255);
  expect(alphaOf(mainWindowContainer)).toBe(0);
  expect(getComputedStyle(mainGroup).borderRadius).toBe("10px");
  expect(getComputedStyle(leftGroup).boxShadow).toBe("none");
  expect(getComputedStyle(leftGroup).borderTopWidth).toBe("0px");
  // Content tabs raise the whole right panel (tabs + body) onto a single aligned card surface;
  // switching to Details keeps the inspector on the shared frosted board.
  const rightCard = screen.container.querySelector<HTMLElement>("[data-workspace-right-card]")!;
  expect(alphaOf(rightCard)).toBe(255);
  expect(getComputedStyle(rightCard).borderRadius).toBe("10px");
  expect(
    Math.abs(rightCard.getBoundingClientRect().top - mainGroup.getBoundingClientRect().top),
  ).toBeLessThanOrEqual(1);
  await userEvent.click(screen.getByRole("tab", { name: "Details", exact: true }));
  await expect.element(inspector).toBeVisible();
  expect(screen.container.querySelector("[data-workspace-right-card]")).toBeNull();
  expect(alphaOf(rightGroup)).toBe(0);
  expect(getComputedStyle(rightGroup).boxShadow).toBe("none");
  await userEvent.click(screen.getByRole("tab", { name: "Files", exact: true }));
  await userEvent.click(screen.getByText("Workspace files", { exact: true }));
  await vi.waitFor(() =>
    expect(
      Math.abs(rightGroup.getBoundingClientRect().width - mainGroup.getBoundingClientRect().width),
    ).toBeLessThan(8),
  );
  const leftResizeBar = screen
    .getByRole("separator", { name: "Resize Left panel" })
    .element()
    .querySelector("span")!;
  const rightResizeBar = screen
    .getByRole("separator", { name: "Resize Right panel" })
    .element()
    .querySelector("span")!;
  const leftBounds = leftGroup.getBoundingClientRect();
  const mainBounds = mainGroup.getBoundingClientRect();
  const rightBounds = screen.container
    .querySelector<HTMLElement>("[data-workspace-right-card]")!
    .getBoundingClientRect();
  const leftBarBounds = leftResizeBar.getBoundingClientRect();
  const rightBarBounds = rightResizeBar.getBoundingClientRect();
  expect(getComputedStyle(leftResizeBar).transform).toBe("none");
  expect(getComputedStyle(rightResizeBar).transform).toBe("none");
  expect(mainBounds.left - leftBounds.right).toBe(6);
  expect(rightBounds.left - mainBounds.right).toBe(6);
  expect(leftBarBounds.left - leftBounds.right).toBeCloseTo(
    mainBounds.left - leftBarBounds.right,
    5,
  );
  expect(rightBarBounds.left - mainBounds.right).toBeCloseTo(
    rightBounds.left - rightBarBounds.right,
    5,
  );

  await userEvent.click(screen.getByRole("tab", { name: "Details", exact: true }));
  await vi.waitFor(() => expect(Math.round(rightGroup.getBoundingClientRect().width)).toBe(280));
  expect(alphaOf(dock)).toBeGreaterThan(100);
  expect(alphaOf(dock)).toBeLessThan(160);
  expect(alphaOf(leftGroup)).toBe(0);
  expect(alphaOf(rightGroup)).toBe(0);

  using _glassStyle = {
    [Symbol.dispose]: () => {
      document.documentElement.style.removeProperty("--glass-opacity");
      document.documentElement.style.removeProperty("--glass-blur");
    },
  };
  document.documentElement.style.setProperty("--glass-opacity", "40%");
  expect(alphaOf(dock)).toBeLessThan(30);
  expect(alphaOf(leftGroup)).toBe(0);
  expect(alphaOf(rightGroup)).toBe(0);
  expect(alphaOf(mainGroup)).toBe(255);

  document.documentElement.style.setProperty("--glass-opacity", "100%");
  document.documentElement.style.setProperty("--glass-blur", "0px");
  expect(alphaOf(dock)).toBe(255);
  expect(alphaOf(leftGroup)).toBe(0);
  expect(alphaOf(rightGroup)).toBe(0);
  document.documentElement.style.removeProperty("--glass-opacity");
  document.documentElement.style.removeProperty("--glass-blur");

  await screen.rerender(ui(true, false));
  expect(alphaOf(dock)).toBe(255);
  expect(alphaOf(leftGroup)).toBe(0);
  expect(alphaOf(rightGroup)).toBe(0);
});

it("dismisses the floating modal overlay on backdrop click or Escape, restores from the window corner, and docks back", async () => {
  await page.viewport(1280, 800);
  using _layout = isolatedLayout();
  localStorage.setItem(
    "t3code:workspace-layout:v1",
    JSON.stringify({
      placements: {
        file: { panel: "floating", group: "floating" },
      },
      hidden: { floating: false },
      active: { floating: "file" },
    }),
  );
  await using screen = await render(
    <div className="h-screen w-screen">
      <WorkspaceRoot>
        <WorkspaceWindow id="threads" title="Threads" panel="left" fixed>
          <p>Threads</p>
        </WorkspaceWindow>
        <WorkspaceWindow id="chat:main" title="Chat" panel="main" fixed>
          <p>Chat</p>
        </WorkspaceWindow>
        <WorkspaceWindow id="file" title="README" panel="right" selected>
          <p>Floating file content</p>
        </WorkspaceWindow>
      </WorkspaceRoot>
    </div>,
  );

  const overlay = screen.container.querySelector("[data-workspace-floating-overlay]")!;
  const backdrop = screen.container.querySelector("[data-workspace-floating-backdrop]")!;
  expect(overlay.hasAttribute("hidden")).toBe(false);

  // Clicking the exposed backdrop edge dismisses the floating overlay.
  await userEvent.click(backdrop, { position: { x: 8, y: 8 } });
  await vi.waitFor(() => expect(overlay.hasAttribute("hidden")).toBe(true));

  // Clicking the window toggle restores it.
  await userEvent.click(screen.getByRole("button", { name: "Toggle Floating panel" }));
  await vi.waitFor(() => expect(overlay.hasAttribute("hidden")).toBe(false));

  const floatingFile = screen.getByText("Floating file content");
  const floatingHost = floatingFile
    .element()
    .closest("[data-workspace-window-container]")!.parentElement;
  await floatingFile.click();
  await userEvent.keyboard("{Shift>}{Escape}{/Shift}");
  await vi.waitFor(() =>
    expect(
      floatingFile
        .element()
        .closest("[data-workspace-maximized-stage]")
        ?.getAttribute("data-workspace-maximized-stage"),
    ).toBe("full"),
  );
  expect(backdrop.hasAttribute("hidden")).toBe(true);
  expect(floatingFile.element().closest("[data-workspace-window-container]")!.parentElement).toBe(
    floatingHost,
  );
  await userEvent.keyboard("{Shift>}{Escape}{/Shift}");
  await vi.waitFor(() => expect(overlay.contains(floatingFile.element())).toBe(true));
  expect(overlay.hasAttribute("hidden")).toBe(false);

  // Pressing Escape dismisses it again.
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(overlay.hasAttribute("hidden")).toBe(true));

  // Restore and dock back to default right panel.
  await userEvent.click(screen.getByRole("button", { name: "Toggle Floating panel" }));
  await vi.waitFor(() => expect(overlay.hasAttribute("hidden")).toBe(false));
  await userEvent.click(screen.getByRole("button", { name: "Move to Right panel" }));
  await vi.waitFor(() =>
    expect(
      screen
        .getByText("Floating file content")
        .element()
        .closest("[data-workspace-panel]")
        ?.getAttribute("data-workspace-panel"),
    ).toBe("right"),
  );
});

it("automatically half-splits right content tabs while keeping the left sidebar open, forbids Details maximize, and toggles single-stage full view cleanly", async () => {
  await page.viewport(1280, 800);
  using _layout = isolatedLayout();
  await using screen = await render(
    <div className="h-screen w-screen">
      <WorkspaceRoot>
        <WorkspaceWindow id="threads" title="Threads" panel="left" fixed>
          <button>Thread item</button>
        </WorkspaceWindow>
        <WorkspaceWindow id="chat:main" title="Conversation" panel="main" selected>
          <div
            aria-label="Conversation history"
            role="region"
            className="messages-timeline-scroll min-h-0 flex-1 overflow-y-auto"
          >
            <div className="h-[2000px]" />
          </div>
          <input aria-label="chat draft" defaultValue="keep chat alive" />
        </WorkspaceWindow>
        <WorkspaceWindow id="details:env:main" title="Details" panel="right">
          <button>Inspector item</button>
        </WorkspaceWindow>
        <WorkspaceWindow id="surface:file" title="README.md" panel="right" selected>
          <input aria-label="file editor" defaultValue="keep editor alive" />
        </WorkspaceWindow>
        <WorkspaceWindow id="surface:notes" title="Notes.md" panel="right">
          <p>Project notes</p>
        </WorkspaceWindow>
      </WorkspaceRoot>
    </div>,
  );

  const chatInput = screen.getByRole("textbox", { name: "chat draft" }).element();
  const fileInput = screen.getByRole("textbox", { name: "file editor" }).element();
  const mainPanel = chatInput.closest<HTMLElement>('[data-workspace-panel="main"]')!;
  const rightPanel = fileInput.closest<HTMLElement>('[data-workspace-panel="right"]')!;
  const leftToggle = screen.getByRole("button", { name: "Toggle Left panel" });
  const threadBtn = screen.getByRole("button", { name: "Thread item" }).element();

  // Left sidebar stays open while README.md automatically takes half of the remaining workspace.
  expect(threadBtn.checkVisibility()).toBe(true);
  await vi.waitFor(() =>
    expect(
      Math.abs(rightPanel.getBoundingClientRect().width - mainPanel.getBoundingClientRect().width),
    ).toBeLessThan(8),
  );
  expect(
    Math.round(rightPanel.getBoundingClientRect().left - mainPanel.getBoundingClientRect().right),
  ).toBe(6);

  // Left session sidebar (`threads`) and `details:*` inspector cannot maximize in app, and never show a pane outline.
  threadBtn.focus();
  await userEvent.keyboard("{Shift>}{Escape}{/Shift}");
  expect(screen.container.querySelector("[data-workspace-maximized]")).toBeNull();

  await userEvent.click(screen.getByRole("tab", { name: "Details", exact: true }));
  await vi.waitFor(() => expect(Math.round(rightPanel.getBoundingClientRect().width)).toBe(280));
  const inspectorWin = screen
    .getByRole("button", { name: "Inspector item" })
    .element()
    .closest<HTMLElement>("[data-workspace-window]")!;
  inspectorWin.focus();
  expect(getComputedStyle(inspectorWin).outlineStyle).toBe("none");
  await userEvent.keyboard("{Shift>}{Escape}{/Shift}");
  expect(screen.container.querySelector("[data-workspace-maximized]")).toBeNull();

  await userEvent.click(screen.getByRole("tab", { name: "README.md", exact: true }));
  await vi.waitFor(() =>
    expect(
      Math.abs(rightPanel.getBoundingClientRect().width - mainPanel.getBoundingClientRect().width),
    ).toBeLessThan(8),
  );

  const history = screen.getByRole("region", { name: "Conversation history" }).element();
  history.scrollTop = 420;
  const fileHost = fileInput.closest("[data-workspace-window-container]")!.parentElement;
  const chatHost = chatInput.closest("[data-workspace-window-container]")!.parentElement;

  // 1st Shift+Esc on content tab jumps straight to full stage (no Stage 1, no redundant maximize pill).
  fileInput.focus();
  await userEvent.keyboard("{Shift>}{Escape}{/Shift}");
  await vi.waitFor(() =>
    expect(
      screen.container
        .querySelector("[data-workspace-dock]")
        ?.getAttribute("data-workspace-maximized"),
    ).toBe("full"),
  );
  expect(screen.container.querySelector("[data-workspace-maximize-pill]")).toBeNull();
  await vi.waitFor(() => expect(chatInput.checkVisibility()).toBe(false));
  expect(fileInput.checkVisibility()).toBe(true);
  expect(fileInput.closest("[data-workspace-window-container]")!.parentElement).toBe(fileHost);
  expect(chatInput.closest("[data-workspace-window-container]")!.parentElement).toBe(chatHost);
  expect(screen.container.querySelector('[data-workspace-edge-peek="left"]')).not.toBeNull();
  const fullStage = screen.container.querySelector<HTMLElement>(
    '[data-workspace-maximized-stage="full"]',
  )!;
  await expect
    .element(page.elementLocator(fullStage).getByRole("button", { name: "Window actions" }))
    .toBeVisible();
  const dockBounds = screen.container
    .querySelector<HTMLElement>("[data-workspace-dock]")!
    .getBoundingClientRect();
  // Keeps 6px continuous frosted board seam around full stage!
  expect(Math.round(fullStage.getBoundingClientRect().left - dockBounds.left)).toBe(6);
  expect(Math.round(dockBounds.right - fullStage.getBoundingClientRect().right)).toBe(6);
  expect(Math.round(dockBounds.bottom - fullStage.getBoundingClientRect().bottom)).toBe(6);

  // Clicking Details tab while maximized exits full stage back to narrow inspector.
  await userEvent.click(screen.getByRole("tab", { name: "Details", exact: true }));
  await vi.waitFor(() =>
    expect(screen.container.querySelector("[data-workspace-maximized]")).toBeNull(),
  );
  expect(threadBtn.checkVisibility()).toBe(true);

  // Switch back to README.md, maximize, then press 2nd Shift+Esc to restore 3-panel half-split without remounting inputs.
  await userEvent.click(screen.getByRole("tab", { name: "README.md", exact: true }));
  await userEvent.dblClick(screen.getByRole("tab", { name: "README.md", exact: true }));
  await vi.waitFor(() =>
    expect(fileInput.closest('[data-workspace-maximized-stage="full"]')).not.toBeNull(),
  );
  fileInput.focus();
  await userEvent.keyboard("{Shift>}{Escape}{/Shift}");
  await vi.waitFor(() =>
    expect(screen.container.querySelector("[data-workspace-maximized]")).toBeNull(),
  );
  expect(threadBtn.checkVisibility()).toBe(true);
  expect(history.scrollTop).toBe(420);
  expect(chatInput).toBe(screen.getByRole("textbox", { name: "chat draft" }).element());
  expect(fileInput).toBe(screen.getByRole("textbox", { name: "file editor" }).element());

  await userEvent.click(leftToggle);
  await expect.element(leftToggle).toHaveAttribute("aria-pressed", "false");
  await userEvent.click(screen.getByRole("button", { name: "Maximize in app" }));
  await vi.waitFor(() =>
    expect(fileInput.closest('[data-workspace-maximized-stage="full"]')).not.toBeNull(),
  );
  await userEvent.click(screen.getByRole("button", { name: "Restore from app maximize" }));
  await vi.waitFor(() =>
    expect(screen.container.querySelector("[data-workspace-maximized]")).toBeNull(),
  );
  await expect.element(leftToggle).toHaveAttribute("aria-pressed", "false");

  fileInput.focus();
  const mac = /mac/i.test(navigator.platform);
  await userEvent.keyboard(
    mac
      ? "{Control>}{Meta>}{Shift>} {/Shift}{/Meta}{/Control}"
      : "{Control>}{Alt>}{Shift>} {/Shift}{/Alt}{/Control}",
  );
  await vi.waitFor(() =>
    expect(fileInput.closest("[data-workspace-panel]")?.getAttribute("data-workspace-panel")).toBe(
      "floating",
    ),
  );
  await userEvent.keyboard("{Escape}");
  await userEvent.keyboard(mac ? "{Control>}2{/Control}" : "{Alt>}2{/Alt}");
  await vi.waitFor(() => expect(document.activeElement).toBe(chatInput));

  // Main chat (`chat:main`): 1st Shift+Esc jumps straight to full app maximize without redundant header pill.
  chatInput.focus();
  await userEvent.keyboard("{Shift>}{Escape}{/Shift}");
  await vi.waitFor(() =>
    expect(
      screen.container
        .querySelector("[data-workspace-dock]")
        ?.getAttribute("data-workspace-maximized"),
    ).toBe("full"),
  );
  expect(screen.container.querySelector("[data-workspace-maximize-pill]")).toBeNull();
  expect(chatInput.checkVisibility()).toBe(true);
  await vi.waitFor(() => expect(fileInput.checkVisibility()).toBe(false));
});

it("keeps text at a fixed width during a right-tab resize and can reverse it mid-flight", async () => {
  await page.viewport(1280, 800);
  using _layout = isolatedLayout();
  const settings = getClientSettings();
  using _settings = { [Symbol.dispose]: () => __setClientSettingsForTests(settings) };
  __setClientSettingsForTests({ ...settings, panelAnimationDurationMs: 375 });
  await using screen = await render(
    <div className="h-screen">
      <WorkspaceRoot>
        <WorkspaceWindow id="chat:main" title="Conversation" panel="main">
          <p>Conversation body</p>
        </WorkspaceWindow>
        <WorkspaceWindow id="details:main" title="Details" panel="right" selected>
          <p>Inspector body</p>
        </WorkspaceWindow>
        <WorkspaceWindow id="file" title="File" panel="right">
          <p>File body</p>
          <BrowserSurfaceSlot tabId="right-tab-resize" visible className="h-20 w-full" />
        </WorkspaceWindow>
      </WorkspaceRoot>
    </div>,
  );
  const inspector = screen.getByRole("tab", { name: "Details" }).element() as HTMLButtonElement;
  const fileTab = screen.getByRole("tab", { name: "File" }).element() as HTMLButtonElement;
  const panel = inspector.closest<HTMLElement>("[data-workspace-panel]")!;
  const surface = panel.querySelector<HTMLElement>("[data-workspace-panel-surface]")!;
  const inspectorWidth = panel.offsetWidth;
  await act(() => fileTab.click());
  const file = screen.getByText("File body").element() as HTMLElement;
  const chat = screen.getByText("Conversation body").element() as HTMLElement;
  const fileWidth = file.offsetWidth;
  const chatWidth = chat.offsetWidth;
  expect(fileWidth).toBeGreaterThan(inspectorWidth);
  const animation = surface.getAnimations()[0]!;
  animation.pause();
  animation.currentTime = 75;
  const firstClip = getComputedStyle(surface).clipPath;
  await vi.waitFor(() => {
    const guest = useBrowserSurfaceStore.getState().byTabId["right-tab-resize"];
    expect(guest?.visible).toBe(true);
    expect(guest?.rect?.width).toBe(fileWidth);
    expect(guest?.rect?.clipPath).toMatch(/^inset\(0px [1-9]/);
  });
  animation.currentTime = 200;
  expect(getComputedStyle(surface).clipPath).not.toBe(firstClip);
  expect([file.offsetWidth, chat.offsetWidth]).toEqual([fileWidth, chatWidth]);
  const lastLeft = surface.getBoundingClientRect().left;
  await act(() => inspector.click());
  const reverse = surface.getAnimations()[0]!;
  reverse.pause();
  reverse.currentTime = 0;
  expect(Math.abs(surface.getBoundingClientRect().left - lastLeft)).toBeLessThan(1);
  for (const moving of screen.container.querySelectorAll(
    '[data-workspace-moving] > :is([data-workspace-panel-surface], [role="separator"])',
  )) {
    for (const effect of moving.getAnimations()) effect.finish();
  }
  await vi.waitFor(() => expect(surface.style.width).toBe(""));
  expect(panel.offsetWidth).toBe(inspectorWidth);
});

it("opens a cold and a warm half panel from the same edge and can reverse a close without reflowing its contents", async () => {
  await page.viewport(1280, 800);
  using _layout = isolatedLayout();
  localStorage.setItem(
    "t3code:workspace-layout:v1",
    JSON.stringify({
      placements: { "surface:terminal": { panel: "right", group: "right" } },
      active: { right: "details:test" },
      hidden: { right: true },
    }),
  );
  const settings = getClientSettings();
  using _settings = { [Symbol.dispose]: () => __setClientSettingsForTests(settings) };
  __setClientSettingsForTests({ ...settings, panelAnimationDurationMs: 375 });

  function Windows() {
    const [terminal, setTerminal] = useState(false);
    const panel = useWorkspacePanel("right");
    return (
      <>
        <WorkspaceWindow id="chat:test" title="Chat" panel="main">
          <button
            onClick={() => {
              setTerminal(true);
              panel?.revealWindow("surface:terminal");
            }}
          >
            Open terminal
          </button>
        </WorkspaceWindow>
        <WorkspaceWindow id="details:test" title="Details" panel="right">
          <p>Thread details</p>
        </WorkspaceWindow>
        {terminal && (
          <WorkspaceWindow id="surface:terminal" title="Terminal" panel="right" selected>
            <input aria-label="Terminal input" />
          </WorkspaceWindow>
        )}
      </>
    );
  }
  await using screen = await render(
    <div className="h-screen">
      <WorkspaceRoot>
        <Windows />
      </WorkspaceRoot>
    </div>,
  );
  const main = screen.container.querySelector<HTMLElement>('[data-workspace-panel="main"]')!;
  const right = screen.container.querySelector<HTMLElement>('[data-workspace-panel="right"]')!;
  const chat = main.querySelector<HTMLElement>("[data-workspace-panel-surface]")!;
  const surface = right.querySelector<HTMLElement>("[data-workspace-panel-surface]")!;
  const toggle = screen
    .getByRole("button", { name: "Toggle Right panel" })
    .element() as HTMLButtonElement;
  const open = screen.getByRole("button", { name: "Open terminal" }).element() as HTMLButtonElement;
  const outerEdge = main.getBoundingClientRect().right;
  const fullWidth = chat.offsetWidth;
  const sample = (time: number) => {
    for (const animation of [chat, surface].flatMap((el) => el.getAnimations())) {
      animation.pause();
      animation.currentTime = time;
    }
    return surface.getBoundingClientRect().left;
  };
  const settle = async () => {
    for (const panel of [main, right]) {
      for (const animation of panel.getAnimations({ subtree: true })) animation.finish();
    }
    await vi.waitFor(() => expect(surface.style.width).toBe(""));
  };
  await act(() => open.click());
  expect(surface.getAnimations()).toHaveLength(1);
  expect(sample(0)).toBeCloseTo(outerEdge, 0);
  const firstMid = sample(150);
  const firstClip = getComputedStyle(surface).clipPath;
  expect(chat.offsetWidth).toBe(fullWidth);
  const terminalWidth = surface.offsetWidth;
  expect(terminalWidth).toBeGreaterThan(fullWidth * 0.48);
  await settle();
  const end = right.getBoundingClientRect();
  expect(end.left - main.getBoundingClientRect().right).toBe(6);
  const saved = JSON.parse(localStorage.getItem("t3code:workspace-layout:v1")!);
  expect(saved.hidden.right).toBe(false);
  expect(saved.active.right).toBe("surface:terminal");

  await act(() => toggle.click());
  expect(right.inert).toBe(true);
  const closingLeft = sample(100);
  const closingClip = getComputedStyle(surface).clipPath;
  expect(closingLeft).toBeGreaterThan(end.left);
  expect(surface.offsetWidth).toBe(terminalWidth);
  await act(() => toggle.click());
  expect(sample(0)).toBeCloseTo(closingLeft, 0);
  expect(getComputedStyle(surface).clipPath).toBe(closingClip);
  expect(surface.offsetWidth).toBe(terminalWidth);
  await settle();
  await act(() => toggle.click());
  await settle();
  expect(surface.checkVisibility()).toBe(false);
  expect(main.getBoundingClientRect().right).toBe(outerEdge);
  await act(() => toggle.click());
  expect(sample(0)).toBeCloseTo(outerEdge, 0);
  expect(sample(150)).toBeCloseTo(firstMid, 0);
  expect(getComputedStyle(surface).clipPath).toBe(firstClip);
  expect(chat.offsetWidth).toBe(fullWidth);
  await settle();
  expect(right.getBoundingClientRect().left).toBe(end.left);
});

it("renders a 6px board seam between intra-panel split groups, resizes weights, and toggles monocle zoom in panel", async () => {
  await page.viewport(1280, 800);
  using _layout = isolatedLayout();
  // Synthetic pointer events have no active browser pointer to capture.
  using _capture = vi
    .spyOn(HTMLElement.prototype, "setPointerCapture")
    .mockImplementation(() => {});
  await using screen = await render(
    <div className="h-screen w-screen">
      <WorkspaceRoot>
        <WorkspaceWindow id="chat:main" title="Conversation" panel="main" fixed>
          <p>Main chat</p>
        </WorkspaceWindow>
        <WorkspaceWindow id="surface:diff" title="Diff" panel="right">
          <button>Diff button</button>
        </WorkspaceWindow>
        <WorkspaceWindow id="surface:terminal" title="Terminal" panel="right" selected>
          <button>Terminal button</button>
        </WorkspaceWindow>
      </WorkspaceRoot>
    </div>,
  );

  const termBtn = screen.getByRole("button", { name: "Terminal button" }).element();
  termBtn.focus();

  // Split focused window down (vertical split inside Right panel) via Window actions menu.
  await userEvent.click(
    page
      .elementLocator(termBtn.closest("[data-workspace-panel]")!)
      .getByRole("button", { name: "Window actions" }),
  );
  await userEvent.click(page.getByRole("menuitem", { name: "Split vertically" }));

  const groups = screen.container.querySelectorAll(
    '[data-workspace-panel="right"] [data-workspace-group]',
  );
  expect(groups).toHaveLength(2);
  const topRect0 = groups[0]!.getBoundingClientRect();
  const bottomRect0 = groups[1]!.getBoundingClientRect();
  // Intra-panel split gap must match the 6px board seam.
  expect(Math.round(bottomRect0.top - topRect0.bottom)).toBe(6);

  const splitHandle = screen.container.querySelector<HTMLElement>("[data-workspace-group-resize]")!;
  const handleRect = splitHandle.getBoundingClientRect();
  await act(() => {
    splitHandle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 1,
        clientX: handleRect.x + 20,
        clientY: handleRect.y + 3,
      }),
    );
    splitHandle.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 1,
        clientX: handleRect.x + 20,
        clientY: handleRect.y + 90,
      }),
    );
    splitHandle.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 1,
        clientX: handleRect.x + 20,
        clientY: handleRect.y + 90,
      }),
    );
  });
  expect(groups[0]!.getBoundingClientRect().height).toBeGreaterThan(topRect0.height + 40);

  // Double-click seam resets back to equal 50/50 split.
  await userEvent.dblClick(splitHandle);
  await vi.waitFor(() =>
    expect(
      Math.abs(
        groups[0]!.getBoundingClientRect().height - groups[1]!.getBoundingClientRect().height,
      ),
    ).toBeLessThan(4),
  );

  // Maximize in panel (monocle) hides sibling group inside Right panel while keeping Main chat visible.
  termBtn.focus();
  await userEvent.click(
    page
      .elementLocator(termBtn.closest("[data-workspace-window]")!)
      .getByRole("button", { name: "Window actions" }),
  );
  await userEvent.click(page.getByRole("menuitem", { name: "Maximize in panel" }));
  await vi.waitFor(() => expect(groups[0]!.hasAttribute("hidden")).toBe(true));
  expect(groups[1]!.hasAttribute("hidden")).toBe(false);
  expect(screen.getByText("Main chat").element().checkVisibility()).toBe(true);
});

it("toggles main focus between composer and conversation on focusPanel.main and focuses before closing right panel", async () => {
  localStorage.clear();
  const handlers: { right?: () => void } = {};

  function ShortcutHarness({ onReady }: { onReady: (next: { right: () => void }) => void }) {
    const rightPanel = useWorkspacePanel("right");
    useEffect(() => {
      onReady({
        right: () => {
          rightPanel?.focusOrToggle();
        },
      });
    }, [onReady, rightPanel]);
    return null;
  }

  await using screen = await render(
    <div className="h-[640px] w-[1100px]">
      <WorkspaceRoot>
        <ShortcutHarness
          onReady={(next) => {
            Object.assign(handlers, next);
          }}
        />
        <WorkspaceWindow id="chat:main" title="Conversation" panel="main" fixed>
          <div data-workspace-area="conversation" tabIndex={-1}>
            <div data-workspace-focus-default="" tabIndex={-1} data-testid="conv-scroller">
              History
            </div>
          </div>
          <div data-workspace-area="composer" tabIndex={-1}>
            <div
              contentEditable
              suppressContentEditableWarning
              data-testid="composer-editor"
              tabIndex={0}
            >
              Draft
            </div>
          </div>
        </WorkspaceWindow>
        <WorkspaceWindow id="surface:files" title="Files" panel="right">
          <input aria-label="right panel input" />
        </WorkspaceWindow>
      </WorkspaceRoot>
    </div>,
    { router: false },
  );

  const composer = screen.container.querySelector<HTMLElement>('[data-testid="composer-editor"]')!;
  const conversation = screen.container.querySelector<HTMLElement>(
    '[data-testid="conv-scroller"]',
  )!;
  const rightInput = screen
    .getByRole("textbox", { name: "right panel input" })
    .element() as HTMLElement;

  // Start in right panel -> focusPanel.main focuses composer; pressing again toggles to conversation and back.
  rightInput.focus();
  expect(document.activeElement).toBe(rightInput);
  const mac = navigator.platform.toUpperCase().includes("MAC");
  await userEvent.keyboard(mac ? "{Control>}2{/Control}" : "{Alt>}2{/Alt}");
  await vi.waitFor(() => expect(document.activeElement).toBe(composer));
  await userEvent.keyboard(mac ? "{Control>}2{/Control}" : "{Alt>}2{/Alt}");
  await vi.waitFor(() => expect(document.activeElement).toBe(conversation));
  await userEvent.keyboard(mac ? "{Control>}2{/Control}" : "{Alt>}2{/Alt}");
  await vi.waitFor(() => expect(document.activeElement).toBe(composer));

  // Right panel is open but unfocused -> focusOrToggle focuses it first, second call closes it and returns focus to composer.
  await act(async () => handlers.right?.());
  await vi.waitFor(() => expect(document.activeElement).toBe(rightInput));
  await act(async () => handlers.right?.());
  await vi.waitFor(() =>
    expect(
      screen.container.querySelector('[data-workspace-panel="right"]')?.hasAttribute("inert"),
    ).toBe(true),
  );
  await vi.waitFor(() => expect(document.activeElement).toBe(composer));
  // Third call reopens right panel and focuses it.
  await act(async () => handlers.right?.());
  await vi.waitFor(() => expect(document.activeElement).toBe(rightInput));
});

it("closes right panel immediately via focusOrToggle when only Details is open and aligns header controls vertically", async () => {
  localStorage.clear();
  const handlers: { right?: () => void } = {};

  function DetailsOnlyHarness({ onReady }: { onReady: (next: { right: () => void }) => void }) {
    const rightPanel = useWorkspacePanel("right");
    useEffect(() => {
      onReady({
        right: () => {
          rightPanel?.focusOrToggle();
        },
      });
    }, [onReady, rightPanel]);
    return null;
  }

  await using screen = await render(
    <div className="h-[640px] w-[1100px]">
      <WorkspaceRoot>
        <DetailsOnlyHarness
          onReady={(next) => {
            Object.assign(handlers, next);
          }}
        />
        <WorkspaceWindow id="chat:main" title="Conversation" panel="main" fixed>
          <div data-workspace-area="composer" tabIndex={-1}>
            <div
              contentEditable
              suppressContentEditableWarning
              data-testid="composer-editor"
              tabIndex={0}
            >
              Draft
            </div>
          </div>
        </WorkspaceWindow>
        <WorkspaceWindow id="details:thread-1" title="Details" panel="right">
          <button type="button">Branch</button>
        </WorkspaceWindow>
      </WorkspaceRoot>
    </div>,
    { router: false },
  );

  const composer = screen.container.querySelector<HTMLElement>('[data-testid="composer-editor"]')!;
  const rightPanel = screen.container.querySelector<HTMLElement>('[data-workspace-panel="right"]')!;
  const detailsTab = rightPanel.querySelector<HTMLElement>('[role="tab"]')!;
  const rightToggle = screen.container.querySelector<HTMLElement>(
    '[data-workspace-controls] button[aria-label="Toggle Right panel"]',
  )!;
  const tabCenterY =
    detailsTab.getBoundingClientRect().top + detailsTab.getBoundingClientRect().height / 2;
  const toggleCenterY =
    rightToggle.getBoundingClientRect().top + rightToggle.getBoundingClientRect().height / 2;
  expect(Math.abs(tabCenterY - toggleCenterY)).toBeLessThanOrEqual(1);

  // Only Details is open -> focusOrToggle closes immediately without focusing Details first.
  composer.focus();
  expect(rightPanel.hasAttribute("inert")).toBe(false);
  await act(async () => handlers.right?.());
  await vi.waitFor(() => expect(rightPanel.hasAttribute("inert")).toBe(true));
  expect(document.activeElement).toBe(composer);

  // Reopening Details-only right panel keeps focus on composer instead of focusing Details.
  await act(async () => handlers.right?.());
  await vi.waitFor(() => expect(rightPanel.hasAttribute("inert")).toBe(false));
  expect(document.activeElement).toBe(composer);
});

it("switches right panel tabs with Mod+1..9 only while focus is inside a multi-tab right panel", async () => {
  using _layout = isolatedLayout();
  const mac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
  await using screen = await render(
    <div className="h-[640px] w-[1100px]">
      <WorkspaceRoot>
        <WorkspaceWindow id="chat:main" title="Conversation" panel="main" fixed>
          <div data-workspace-area="composer" tabIndex={-1}>
            <div
              contentEditable
              suppressContentEditableWarning
              data-testid="composer-editor"
              tabIndex={0}
            >
              Draft
            </div>
          </div>
        </WorkspaceWindow>
        <WorkspaceWindow id="details:thread-1" title="Details" panel="right">
          <div data-workspace-focus-default="" tabIndex={-1} data-testid="details-focus-host">
            <button type="button">Branch</button>
          </div>
        </WorkspaceWindow>
        <WorkspaceWindow id="terminal:1" title="Terminal 1" panel="right" selected>
          <input aria-label="Right terminal input" />
        </WorkspaceWindow>
      </WorkspaceRoot>
    </div>,
    { router: false },
  );

  const composer = screen.container.querySelector<HTMLElement>('[data-testid="composer-editor"]')!;
  const rightPanel = screen.container.querySelector<HTMLElement>('[data-workspace-panel="right"]')!;
  const terminalInput = screen.container.querySelector<HTMLInputElement>(
    'input[aria-label="Right terminal input"]',
  )!;
  const dispatchModDigit = (digit: string, target: EventTarget) => {
    const event = new KeyboardEvent("keydown", {
      key: digit,
      code: `Digit${digit}`,
      metaKey: mac,
      ctrlKey: !mac,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    return event;
  };

  // Focus inside right panel (Terminal is tab 2, Details is tab 1) -> Mod+1 switches to Details.
  terminalInput.focus();
  const switchToDetails = dispatchModDigit("1", terminalInput);
  expect(switchToDetails.defaultPrevented).toBe(true);
  await vi.waitFor(() => {
    const tabs = [...rightPanel.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("false");
  });
  const detailsHost = rightPanel.querySelector<HTMLElement>('[data-testid="details-focus-host"]')!;
  expect(document.activeElement).toBe(detailsHost);

  // Focus stayed inside right panel -> Mod+2 switches back to Terminal and focuses its input.
  const switchToTerminal = dispatchModDigit("2", detailsHost);
  expect(switchToTerminal.defaultPrevented).toBe(true);
  await vi.waitFor(() => {
    const tabs = [...rightPanel.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(terminalInput);
  });

  // Focus in main composer -> Mod+1 must not be intercepted by right panel tabs.
  composer.focus();
  const fromComposer = dispatchModDigit("1", composer);
  expect(fromComposer.defaultPrevented).toBe(false);
  const tabsAfterComposer = [...rightPanel.querySelectorAll<HTMLElement>('[role="tab"]')];
  expect(tabsAfterComposer[1]?.getAttribute("aria-selected")).toBe("true");
});
