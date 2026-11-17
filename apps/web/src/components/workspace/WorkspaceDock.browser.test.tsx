import "~/index.css";
import { useEffect, useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { act, render, stubGlobal } from "../../../test/render";
import { DEFAULT_CLIENT_SETTINGS, type DesktopWindowDisplaySpace } from "@t3tools/contracts";
import { BrowserSurfaceSlot } from "../../browser/BrowserSurfaceSlot";
import { useBrowserSurfaceStore } from "../../browser/browserSurfaceStore";
import { installDesktopWallpaperBackdrop } from "../../desktopWallpaperBackdrop";
import { __setClientSettingsForTests, persistClientSettingsPatch } from "../../hooks/useSettings";
import { syncDocumentElectronPlatformClasses } from "../../lib/windowControlsOverlay";
import {
  WorkspaceActions,
  WorkspacePanelActions,
  WorkspaceRoot,
  WorkspaceWindow,
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
it("keeps live window content when moving, splitting, hiding and restoring it, with every tab in the titlebar", async () => {
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
        <WorkspaceActions windowId="chat:test" onOpenBottom={() => {}} onOpenRight={() => {}}>
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
    screen.container.querySelector("[data-workspace-titlebar] [data-workspace-window-controls]"),
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
  expect(screen.container.querySelectorAll('[data-workspace-panel] [role="tab"]')).toHaveLength(0);
  expect(input).toBe(screen.getByRole("textbox", { name: "draft" }).element());
  expect(chatControls.closest("[data-workspace-window]")).toBe(
    input.closest("[data-workspace-window]"),
  );
  expect(mount).toHaveBeenCalledTimes(1);
  expect(dispose).not.toHaveBeenCalled();
  expect(frame.contentDocument).toBe(frameDocument);
  await userEvent.click(
    page
      .elementLocator(input.closest("[data-workspace-window]")!)
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
    screen.container.querySelectorAll("[data-workspace-titlebar] button[aria-pressed]"),
  ).toHaveLength(3);
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
  expect(
    screen.container.querySelector("[data-workspace-titlebar]")?.getBoundingClientRect().height,
  ).toBe(34);
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
        terminal: { panel: "bottom", group: "bottom" },
      },
      hidden: { right: true, bottom: true },
      active: { right: "file" },
    }),
  );
  await using screen = await render(
    <div className="h-screen w-screen">
      <WorkspaceRoot>
        <WorkspaceWindow id="terminal" title="Terminal" panel="bottom">
          <p>Terminal content</p>
        </WorkspaceWindow>
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
  const titlebar = screen.container.querySelector("[data-workspace-titlebar]")!;
  expect(titlebar.textContent).not.toContain("T3 Code");
  expect(
    screen
      .getByRole("button", { name: "Toggle Left panel" })
      .element()
      .closest("[data-workspace-titlebar-leading]"),
  ).not.toBeNull();
  const bottomToggle = screen.getByRole("button", { name: "Toggle Bottom panel" });
  await expect.element(bottomToggle).toHaveAttribute("aria-pressed", "false");
  await userEvent.click(bottomToggle);
  await expect.element(screen.getByText("Terminal content", { exact: true })).toBeVisible();
  await expect.element(bottomToggle).toHaveAttribute("aria-pressed", "true");
  await expect.element(screen.getByRole("tab", { name: "Terminal", exact: true })).toBeVisible();
  await userEvent.click(bottomToggle);
  await expect.element(bottomToggle).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("tab", { name: "Terminal", exact: true }).all()).toHaveLength(0);
  const sidebar = screen.getByText("Pinned threads").element().closest("[data-workspace-window]")!;
  expect(sidebar.closest("[data-workspace-panel]")?.getAttribute("data-workspace-panel")).toBe(
    "left",
  );
  expect(sidebar.querySelector("[data-workspace-window-controls]")).toBeNull();
  expect(sidebar.querySelector("button")).toBeNull();
  expect(
    screen.container.querySelector('[data-workspace-titlebar] [aria-haspopup="menu"]'),
  ).toBeNull();
  await expect
    .element(screen.getByRole("button", { name: "Toggle Right panel" }))
    .toHaveAttribute("aria-pressed", "false");
  await userEvent.click(screen.getByRole("button", { name: "Toggle Right panel" }));
  await expect.element(screen.getByText("Saved file", { exact: true })).toBeVisible();
  expect(
    screen
      .getByRole("button", { name: "Add resource" })
      .element()
      .closest("[data-workspace-panel]")
      ?.getAttribute("data-workspace-panel"),
  ).toBe("right");
});

function TerminalToggle({ bottom = false, onOpen }: { bottom?: boolean; onOpen?: () => void }) {
  const toggle = useWorkspaceWindowToggle();
  return (
    <button
      onClick={() => {
        if (!toggle("drawer:test", bottom ? "bottom" : undefined)) onOpen?.();
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
            panel="bottom"
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
        ? screen.getByRole("button", { name: "Toggle Bottom panel" })
        : screen.getByRole("button", { name: "Toggle terminal window" });
    await userEvent.click(control());
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
        <TerminalToggle bottom onOpen={() => setOpen(true)} />
      </WorkspaceWindow>
      <WorkspaceActions
        windowId="chat:current"
        onOpenBottom={() => setOpen(true)}
        onOpenRight={() => {}}
      >
        <span />
      </WorkspaceActions>
      {open && (
        <WorkspaceWindow id="drawer:test" title="Terminal" panel="bottom" selected>
          <input aria-label="active terminal" defaultValue="preserved" />
        </WorkspaceWindow>
      )}
    </>
  );
}
it("opens the active thread's bottom panel instead of an unavailable thread's terminal", async () => {
  await page.viewport(1280, 800);
  using _layout = isolatedLayout();
  await using screen = await render(
    <div className="h-screen w-screen">
      <WorkspaceRoot>
        <WorkspaceWindow id="drawer:other" title="Other terminal" panel="bottom" available={false}>
          <p>Other shell</p>
        </WorkspaceWindow>
        <ActiveTerminal />
      </WorkspaceRoot>
    </div>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Toggle Bottom panel" }));
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
        <WorkspaceWindow id="terminal:zoom" title="Terminal" panel="bottom">
          <p>Zoom terminal</p>
        </WorkspaceWindow>
      </WorkspaceRoot>
    </div>,
  );
  await expect.element(screen.getByRole("textbox", { name: "draft" })).toBeVisible();
  const input = screen.getByRole("textbox", { name: "draft" }).element();
  await userEvent.fill(screen.getByRole("textbox", { name: "draft" }), "unsent zoom draft");
  await page.viewport(700, 600);
  await expect.element(screen.getByRole("button", { name: "Toggle Bottom panel" })).toBeVisible();
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
  "returns a moved terminal to the bottom when explicitly toggling the drawer (mounted: %s)",
  async (initiallyOpen) => {
    await page.viewport(1280, 800);
    using _layout = isolatedLayout();
    localStorage.setItem(
      "t3code:workspace-layout:v1",
      JSON.stringify({
        placements: { "drawer:test": { panel: "right", group: "right" } },
        hidden: { right: true, bottom: true },
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
    ).toBe("bottom");
  },
);

it("applies 7px concentric window cards, stratified panel translucency, and desktop wallpaper periscope backing", async () => {
  await page.viewport(1280, 800);
  using _layout = isolatedLayout();
  const cleanupPlatform = syncDocumentElectronPlatformClasses("MacIntel");
  using _platform = { [Symbol.dispose]: cleanupPlatform };
  const ui = (fullscreen: boolean) => (
    <div className="h-screen w-screen" data-window-fullscreen={fullscreen ? "true" : undefined}>
      <WorkspaceRoot>
        <WorkspaceWindow id="threads" fixed title="Threads" panel="left">
          <p>Sidebar navigation</p>
        </WorkspaceWindow>
        <WorkspaceWindow id="chat:glass" title="Conversation" panel="main" selected>
          <p>Solid conversation</p>
        </WorkspaceWindow>
        <WorkspaceWindow id="details:glass" title="Inspector" panel="right">
          <p>Inspector details</p>
        </WorkspaceWindow>
      </WorkspaceRoot>
    </div>
  );
  await using screen = await render(ui(false));
  await expect.element(screen.getByText("Solid conversation", { exact: true })).toBeVisible();
  const dock = screen.container.querySelector<HTMLElement>("[data-workspace-dock]")!;
  const titlebar = screen.container.querySelector<HTMLElement>("[data-workspace-titlebar]")!;
  const rightToggles = screen
    .getByRole("button", { name: "Toggle Right panel" })
    .element().parentElement!;
  const mainPanel = screen.container.querySelector<HTMLElement>('[data-workspace-panel="main"]')!;
  const leftGroup = screen.container.querySelector<HTMLElement>(
    '[data-workspace-panel="left"] [data-workspace-group]',
  )!;
  const mainGroup = screen.container.querySelector<HTMLElement>(
    '[data-workspace-panel="main"] [data-workspace-group]',
  )!;
  const rightGroup = screen.container.querySelector<HTMLElement>(
    '[data-workspace-panel="right"] [data-workspace-group]',
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
  expect(getComputedStyle(titlebar).height).toBe("34px");
  expect(getComputedStyle(mainGroup).borderRadius).toBe("7px");
  expect(alphaOf(document.body)).toBe(0);
  expect(alphaOf(mainPanel)).toBe(0);
  expect(alphaOf(titlebar)).toBe(0);
  expect(alphaOf(rightToggles)).toBe(0);

  // Default 80% tier: Z0 ~58%, Left ~88%, Right ~92%, Main 100% solid.
  const defaultGlassAlpha = alphaOf(dock);
  expect(defaultGlassAlpha).toBeGreaterThan(120);
  expect(defaultGlassAlpha).toBeLessThan(180);
  expect(alphaOf(leftGroup)).toBeGreaterThan(205);
  expect(alphaOf(leftGroup)).toBeLessThan(240);
  expect(alphaOf(rightGroup)).toBeGreaterThan(alphaOf(leftGroup));
  expect(alphaOf(rightGroup)).toBeLessThan(250);
  expect(alphaOf(mainGroup)).toBe(255);

  using _glassStyle = {
    [Symbol.dispose]: () => {
      delete document.documentElement.dataset.desktopWallpaperActive;
      document.documentElement.style.removeProperty("--glass-opacity");
      document.documentElement.style.removeProperty("--glass-blur");
    },
  };
  // 40% ultra-glass tier: Left ~70%, Right ~80%, Main stays 100% solid paper.
  document.documentElement.style.setProperty("--glass-opacity", "40%");
  expect(alphaOf(dock)).toBeLessThan(35);
  expect(alphaOf(leftGroup)).toBeGreaterThan(165);
  expect(alphaOf(leftGroup)).toBeLessThan(195);
  expect(alphaOf(rightGroup)).toBeGreaterThan(192);
  expect(alphaOf(rightGroup)).toBeLessThan(220);
  expect(alphaOf(mainGroup)).toBe(255);

  // Periscope desktop-wallpaper controller projects display-space wallpaper and makes body opaque.
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    glassBackdropSource: "wallpaper",
    glassOpacity: 40,
  });
  const listeners = new Set<(space: DesktopWindowDisplaySpace) => void>();
  const disposeWallpaper = installDesktopWallpaperBackdrop(
    () => ({
      readDesktopWallpaper: async () => ({
        mimeType: "image/jpeg",
        data: new Uint8Array([0xff, 0xd8, 0xff]),
        revision: "wp-1",
        space: {
          offsetX: 120,
          offsetY: 64,
          displayWidth: 1920,
          displayHeight: 1200,
          displayKey: "0,0,1920x1200",
        },
      }),
      onWindowDisplaySpaceChange: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    }),
    { preblur: async () => "blob:test-wallpaper" },
  );
  try {
    await vi.waitFor(() =>
      expect(document.documentElement.dataset.desktopWallpaperActive).toBe("true"),
    );
    expect(alphaOf(document.body)).toBe(255);
    expect(alphaOf(leftGroup)).toBeLessThan(195);
    for (const listener of listeners) {
      listener({
        offsetX: 340,
        offsetY: 180,
        displayWidth: 1920,
        displayHeight: 1200,
        displayKey: "0,0,1920x1200",
      });
    }
    expect(document.documentElement.style.getPropertyValue("--desktop-window-offset-x")).toBe(
      "340px",
    );
    await persistClientSettingsPatch({ glassBackdropSource: "behind-window" }, async () => {});
    expect(document.documentElement.dataset.desktopWallpaperActive).toBeUndefined();
  } finally {
    disposeWallpaper();
    __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  }

  // 100% solid mode turns off all translucency.
  document.documentElement.style.setProperty("--glass-opacity", "100%");
  document.documentElement.style.setProperty("--glass-blur", "0px");
  expect(alphaOf(dock)).toBe(255);
  expect(alphaOf(leftGroup)).toBe(255);
  expect(alphaOf(rightGroup)).toBe(255);
  document.documentElement.style.removeProperty("--glass-opacity");
  document.documentElement.style.removeProperty("--glass-blur");

  await screen.rerender(ui(true));
  expect(alphaOf(dock)).toBe(255);
  expect(alphaOf(leftGroup)).toBe(255);
  expect(alphaOf(rightGroup)).toBe(255);
});
