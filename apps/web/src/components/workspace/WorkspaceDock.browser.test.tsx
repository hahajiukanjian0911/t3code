import "~/index.css";
import { useEffect } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { act, render } from "../../../test/render";
import { BrowserSurfaceSlot } from "../../browser/BrowserSurfaceSlot";
import { useBrowserSurfaceStore } from "../../browser/browserSurfaceStore";
import { WorkspaceRoot, WorkspaceWindow } from "./WorkspaceDock";

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
  await userEvent.fill(screen.getByRole("textbox", { name: "draft" }), "unsent draft");
  expect(screen.container.querySelectorAll('[role="tab"]')).toHaveLength(0);
  await userEvent.click(screen.getByRole("textbox", { name: "draft" }));
  await userEvent.click(screen.getByRole("button", { name: "Window actions" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Move to Right panel" }));
  await expect
    .element(screen.getByRole("tab", { name: "Conversation", exact: true }))
    .toBeVisible();
  expect(input.closest("[data-workspace-panel]")?.getAttribute("data-workspace-panel")).toBe(
    "right",
  );
  expect(screen.container.querySelectorAll('[data-workspace-panel] [role="tab"]')).toHaveLength(0);
  expect(input).toBe(screen.getByRole("textbox", { name: "draft" }).element());
  expect(mount).toHaveBeenCalledTimes(1);
  expect(dispose).not.toHaveBeenCalled();
  expect(frame.contentDocument).toBe(frameDocument);
  await userEvent.click(screen.getByRole("button", { name: "Window actions" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Split vertically" }));
  await expect.element(screen.getByText("File content", { exact: true })).toBeVisible();
  expect(
    screen.container.querySelectorAll('[data-workspace-panel="right"] [data-workspace-group]'),
  ).toHaveLength(2);
  await userEvent.click(screen.getByRole("button", { name: "Toggle Right panel" }));
  expect(input.checkVisibility()).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "Toggle Right panel" }));
  await expect.element(screen.getByRole("textbox", { name: "draft" })).toHaveValue("unsent draft");
  await userEvent.click(screen.getByRole("button", { name: "Window actions" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Reset layout" }));
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
  ).toBe(30);
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
      placements: { file: { panel: "right", group: "right" } },
      hidden: { right: true },
      active: { right: "file" },
    }),
  );
  await using screen = await render(
    <div className="h-screen w-screen">
      <WorkspaceRoot>
        <WorkspaceWindow id="file" title="README" panel="right" selected>
          <p>Saved file</p>
        </WorkspaceWindow>
      </WorkspaceRoot>
    </div>,
  );
  await expect
    .element(screen.getByRole("button", { name: "Toggle Right panel" }))
    .toHaveAttribute("aria-pressed", "false");
  await userEvent.click(screen.getByRole("button", { name: "Toggle Right panel" }));
  await expect.element(screen.getByText("Saved file", { exact: true })).toBeVisible();
});
