import { page, userEvent } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { act, fakeTimers, render } from "../../../test/render";
import { Sidebar, SidebarProvider, SidebarRail, SidebarTrigger, useSidebar } from "./sidebar";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./menu";

function CollapseFromInside() {
  const { setOpen } = useSidebar();
  return (
    <button type="button" onClick={() => setOpen(false)}>
      Collapse
    </button>
  );
}

function Harness(props: {
  readonly onResize?: (width: number) => void;
  readonly hoverReveal?: boolean;
  readonly defaultOpen?: boolean;
  readonly storageKey?: string;
  readonly onHold?: (release: () => void) => void;
}) {
  return (
    <SidebarProvider
      defaultOpen={props.defaultOpen ?? true}
      hoverReveal={props.hoverReveal ?? false}
      {...(props.storageKey ? { storageKey: props.storageKey } : {})}
    >
      <Sidebar
        collapsible="offcanvas"
        resizable={{
          minWidth: 200,
          maxWidth: 600,
          ...(props.onResize ? { onResize: props.onResize } : {}),
        }}
      >
        <CollapseFromInside />
        {props.hoverReveal ? (
          <HoverControls {...(props.onHold ? { onHold: props.onHold } : {})} />
        ) : null}
        <SidebarRail />
      </Sidebar>
      <div className="fixed top-4 right-4 z-50" data-sidebar-control="">
        <SidebarTrigger />
      </div>
      <main className="min-w-0 flex-1">Conversation</main>
    </SidebarProvider>
  );
}

function HoverControls({ onHold }: { readonly onHold?: (release: () => void) => void }) {
  const { holdOpen } = useSidebar();
  return (
    <>
      <input aria-label="Rename thread" />
      <button type="button" onClick={() => onHold?.(holdOpen())}>
        Native menu
      </button>
      <Menu>
        <MenuTrigger>Projects</MenuTrigger>
        <MenuPopup side="right">
          <MenuItem>Project settings</MenuItem>
        </MenuPopup>
      </Menu>
    </>
  );
}

function movePointer(clientX: number, buttons = 0, pointerType = "mouse") {
  document.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      clientX,
      clientY: 160,
      buttons,
      pointerType,
    }),
  );
}

describe("Sidebar", () => {
  it("delays edge reveal, cancels a flyby, and preserves collapsed layout and persistence", async () => {
    await page.viewport(1280, 800);
    const storageKey = "sidebar_hover_persistence_test";
    localStorage.removeItem(storageKey);
    using _storage = { [Symbol.dispose]: () => localStorage.removeItem(storageKey) };
    await using screen = await render(
      <Harness hoverReveal defaultOpen={false} storageKey={storageKey} />,
    );
    using _timers = fakeTimers();
    const sidebar = screen.container.querySelector<HTMLElement>('[data-slot="sidebar"]')!;
    const main = screen.container.querySelector("main")!;
    const width = main.getBoundingClientRect().width;
    const saved = localStorage.getItem(storageKey);
    await act(() => {
      movePointer(3);
      vi.advanceTimersByTime(100);
      movePointer(500);
      vi.advanceTimersByTime(150);
    });
    expect(sidebar.inert).toBe(true);
    await act(() => {
      movePointer(3);
      vi.advanceTimersByTime(150);
    });
    await userEvent.keyboard("{Escape}");
    await act(() => vi.advanceTimersByTime(300));
    expect(sidebar.inert).toBe(true);
    await act(() => {
      movePointer(500);
      movePointer(3);
      vi.advanceTimersByTime(149);
    });
    expect(sidebar.inert).toBe(true);
    await act(() => vi.advanceTimersByTime(1));
    expect(sidebar.inert).toBe(false);
    expect(main.getBoundingClientRect().width).toBe(width);
    expect(localStorage.getItem(storageKey)).toBe(saved);
    await act(() => {
      movePointer(500);
      vi.advanceTimersByTime(299);
    });
    expect(sidebar.inert).toBe(false);
    await act(() => {
      movePointer(30);
      vi.advanceTimersByTime(300);
    });
    expect(sidebar.inert).toBe(false);
    await act(() => {
      movePointer(500);
      vi.advanceTimersByTime(300);
    });
    expect(sidebar.inert).toBe(true);
  });

  it("keeps a preview open through menus, editing and pointer drags, then allows pinning", async () => {
    await page.viewport(1280, 800);
    let release: (() => void) | undefined;
    await using screen = await render(
      <Harness
        hoverReveal
        defaultOpen={false}
        onHold={(value) => {
          release = value;
        }}
      />,
    );
    using _timers = fakeTimers();
    const sidebar = screen.container.querySelector<HTMLElement>('[data-slot="sidebar"]')!;
    await act(() => {
      movePointer(3);
      vi.advanceTimersByTime(150);
    });
    await userEvent.click(screen.getByRole("button", { name: "Native menu" }));
    await act(() => {
      movePointer(500);
      vi.advanceTimersByTime(300);
    });
    expect(sidebar.inert).toBe(false);
    await act(() => {
      release?.();
      vi.advanceTimersByTime(300);
    });
    expect(sidebar.inert).toBe(true);

    await act(() => {
      movePointer(3);
      vi.advanceTimersByTime(150);
    });
    await userEvent.click(screen.getByRole("button", { name: "Projects" }));
    await expect
      .element(screen.getByRole("button", { name: "Projects" }))
      .toHaveAttribute("aria-expanded", "true");
    await act(() => {
      movePointer(500);
      vi.advanceTimersByTime(300);
    });
    expect(sidebar.dataset.peek).toBe("true");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("textbox", { name: "Rename thread" }));
    await act(() => {
      movePointer(500);
      vi.advanceTimersByTime(300);
    });
    expect(sidebar.inert).toBe(false);
    await act(() => {
      (document.activeElement as HTMLElement).blur();
    });
    await act(() => {
      movePointer(500, 1);
      vi.advanceTimersByTime(300);
    });
    expect(sidebar.inert).toBe(false);
    await act(() => {
      movePointer(500);
      vi.advanceTimersByTime(300);
    });
    expect(sidebar.inert).toBe(true);

    await act(() => {
      movePointer(3);
      vi.advanceTimersByTime(150);
    });
    await userEvent.click(
      screen.container.querySelector<HTMLElement>('[data-slot="sidebar-trigger"]')!,
    );
    await act(() => {
      movePointer(500);
      vi.advanceTimersByTime(300);
    });
    expect(sidebar.dataset.state).toBe("expanded");
    expect(sidebar.dataset.peek).toBeUndefined();
    expect(sidebar.inert).toBe(false);
  });

  it("ignores touch and pressed-pointer edge entry and cancels pending reveal on unmount", async () => {
    await page.viewport(1280, 800);
    await using screen = await render(<Harness hoverReveal defaultOpen={false} />);
    using _timers = fakeTimers();
    const sidebar = screen.container.querySelector<HTMLElement>('[data-slot="sidebar"]')!;
    await act(() => {
      movePointer(3, 0, "touch");
      vi.advanceTimersByTime(150);
    });
    expect(sidebar.inert).toBe(true);
    await act(() => {
      movePointer(3, 1);
      vi.advanceTimersByTime(150);
    });
    expect(sidebar.inert).toBe(true);
    await act(() => movePointer(3));
    await screen.unmount();
    await act(() => vi.advanceTimersByTime(150));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("hands focus to the outside trigger when it collapses around the focused control", async () => {
    await page.viewport(1280, 800);
    await using screen = await render(<Harness />, { router: false /* no routes involved */ });

    await userEvent.click(screen.getByRole("button", { name: "Collapse" }));

    const sidebar = screen.container.querySelector<HTMLElement>('[data-slot="sidebar"]')!;
    await vi.waitFor(() => expect(sidebar.inert).toBe(true));
    const trigger = screen.container.querySelector('[data-slot="sidebar-trigger"]');
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("abandons a rail drag when the sidebar collapses mid-drag", async () => {
    await page.viewport(1280, 800);
    const onResize = vi.fn();
    await using screen = await render(<Harness onResize={onResize} />, {
      router: false /* no routes involved */,
    });
    const rail = screen.container.querySelector<HTMLElement>('[data-sidebar="rail"]')!;
    const { left, top } = rail.getBoundingClientRect();
    const pointer = { bubbles: true, cancelable: true, pointerId: 1, button: 0, clientY: top + 10 };
    const dragTo = (clientX: number) => {
      rail.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, clientX: left }));
      rail.dispatchEvent(new PointerEvent("pointermove", { ...pointer, clientX }));
    };
    // A completed drag commits, so the abandoned one below is a real drag too.
    dragTo(left + 40);
    rail.dispatchEvent(new PointerEvent("pointerup", { ...pointer, clientX: left + 40 }));
    expect(onResize).toHaveBeenCalledTimes(1);

    dragTo(left + 80);
    await userEvent.click(
      screen.container.querySelector<HTMLElement>('[data-slot="sidebar-trigger"]')!,
    );
    rail.dispatchEvent(new PointerEvent("pointerup", { ...pointer, clientX: left + 80 }));

    expect(onResize).toHaveBeenCalledTimes(1);
  });
});

it("restores collapsed and expanded desktop state after remounting", async () => {
  await page.viewport(1280, 800);
  const storageKey = "sidebar_persistence_test";
  localStorage.removeItem(storageKey);
  const layout = () => (
    <SidebarProvider storageKey={storageKey}>
      <SidebarTrigger />
    </SidebarProvider>
  );
  {
    await using screen = await render(layout(), { router: false /* no routes involved */ });
    const trigger = screen.getByRole("button", { name: "Toggle Sidebar" });
    await expect.element(trigger).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(trigger);
    await expect.element(trigger).toHaveAttribute("aria-pressed", "false");
  }
  {
    await using screen = await render(layout(), { router: false /* no routes involved */ });
    const trigger = screen.getByRole("button", { name: "Toggle Sidebar" });
    await expect.element(trigger).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(trigger);
  }
  await using screen = await render(layout(), { router: false /* no routes involved */ });
  await expect
    .element(screen.getByRole("button", { name: "Toggle Sidebar" }))
    .toHaveAttribute("aria-pressed", "true");
  localStorage.removeItem(storageKey);
});

it("keeps the mobile sheet closed and leaves the saved desktop state alone", async () => {
  await page.viewport(390, 844);
  const storageKey = "sidebar_mobile_persistence_test";
  localStorage.setItem(storageKey, "false");
  {
    await using screen = await render(<Harness hoverReveal storageKey={storageKey} />, {
      router: false /* no routes involved */,
    });
    using _timers = fakeTimers();
    await act(() => {
      movePointer(3);
      vi.advanceTimersByTime(150);
    });
    const trigger = screen.getByRole("button", { name: "Toggle Sidebar" });
    await expect.element(trigger).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(trigger);
    expect(screen.container.querySelector('[data-slot="sidebar-trigger"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(localStorage.getItem(storageKey)).toBe("false");
  }
  await using screen = await render(
    <SidebarProvider storageKey={storageKey}>
      <SidebarTrigger />
    </SidebarProvider>,
    { router: false /* no routes involved */ },
  );
  await expect
    .element(screen.getByRole("button", { name: "Toggle Sidebar" }))
    .toHaveAttribute("aria-pressed", "false");
  localStorage.removeItem(storageKey);
});
