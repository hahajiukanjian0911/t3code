import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { SidebarProvider } from "../ui/sidebar";
import { SidebarThreadHeader } from "./SidebarThreadHeader";

function SidebarThreadHeaderHarness() {
  const toggleRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  const handleToggleSearch = () => {
    if (searchOpen) {
      setSearchQuery("");
      setSearchOpen(false);
      return;
    }
    setSearchOpen(true);
  };

  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      if (searchQuery.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        setSearchQuery("");
        return;
      }
      if (searchOpen) {
        event.preventDefault();
        event.stopPropagation();
        setSearchOpen(false);
        toggleRef.current?.focus();
      }
    }
  };

  return (
    <SidebarProvider>
      <div className="w-64">
        <SidebarThreadHeader
          hasProjects
          projectScope={null}
          onNewProject={vi.fn()}
          onNewThread={vi.fn()}
          newThreadDisabled={false}
          newThreadShortcutLabel={null}
          newThreadInProjectShortcutLabel={null}
          showNewThreadInProjectHint={false}
          searchOpen={searchOpen}
          onToggleSearch={handleToggleSearch}
          searchToggleRef={toggleRef}
          searchInputRef={inputRef}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          onSearchKeyDown={handleSearchKeyDown}
          isSearching={searchQuery.trim().length > 0}
          searchResultCount={searchQuery.trim().length > 0 ? 1 : 0}
          activeSearchResultIndex={0}
          onClearSearch={() => setSearchQuery("")}
        />
      </div>
    </SidebarProvider>
  );
}

it("toggles an expandable full-width search bar with two-stage Escape and clears on close", async () => {
  await using screen = await render(<SidebarThreadHeaderHarness />, {
    // Harness renders SidebarThreadHeader in isolation without route links.
    router: false,
  });

  const toggle = screen.getByRole("button", { name: "Search threads" });
  const tray = document.getElementById("sidebar-thread-search-panel") as HTMLElement;
  await expect.element(toggle).toHaveAttribute("aria-expanded", "false");
  expect(tray.dataset.state).toBe("closed");
  expect(tray.inert).toBe(true);

  await userEvent.click(toggle);
  await expect.element(toggle).toHaveAttribute("aria-expanded", "true");
  expect(tray.dataset.state).toBe("open");
  expect(tray.inert).toBe(false);

  const input = screen.getByRole("combobox", { name: "Search threads" });
  await expect.element(input).toHaveFocus();
  await expect.element(input).toHaveAttribute("type", "text");

  await userEvent.fill(input, "vim");
  await expect.element(input).toHaveValue("vim");

  // First Escape clears the query while keeping the search bar open and focused.
  await userEvent.keyboard("{Escape}");
  await expect.element(input).toHaveValue("");
  await expect.element(toggle).toHaveAttribute("aria-expanded", "true");
  await expect.element(input).toHaveFocus();

  // Second Escape closes the tray and returns focus to the search toggle button.
  await userEvent.keyboard("{Escape}");
  await expect.element(toggle).toHaveAttribute("aria-expanded", "false");
  expect(tray.inert).toBe(true);
  await expect.element(toggle).toHaveFocus();

  // Closing via the toggle button clears any active query so no hidden filter remains.
  await userEvent.click(toggle);
  await userEvent.fill(input, "stale");
  await userEvent.click(toggle);
  await expect.element(toggle).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(toggle);
  await expect.element(input).toHaveValue("");
});
