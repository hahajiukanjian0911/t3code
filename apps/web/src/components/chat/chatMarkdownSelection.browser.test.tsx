import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import "../../index.css";
import ChatMarkdown from "../ChatMarkdown";

it("selects draggable file links and paints continuous full-line selection bands across inline code", async () => {
  const markdown = [
    "### 覆盖面与验证",
    "",
    '- 新增 [SidebarThreadHeader.browser.test.tsx](file:///tmp/SidebarThreadHeader.browser.test.tsx#L1-L115)，覆盖 `inert` 与 `type="text"`。',
    "- 同步更新 `vp test run` (`SidebarThreadHeader.browser.test.tsx` + `Sidebar.drag.browser.test.tsx`)。",
  ].join("\n");

  await using screen = await render(
    <div className="w-[520px] p-4">
      <ChatMarkdown text={markdown} cwd="/tmp" environmentId={EnvironmentId.make("env-sel")} />
    </div>,
  );

  const root = screen.container.querySelector<HTMLElement>(".chat-markdown")!;
  const fileLink = root.querySelector<HTMLAnchorElement>(".chat-markdown-file-link")!;
  // Simulate Electron desktop native file drag attribute (`useNativeFileDrag`).
  fileLink.setAttribute("draggable", "true");

  expect(getComputedStyle(fileLink).userSelect).toBe("text");

  const range = document.createRange();
  range.selectNodeContents(root);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));

  expect(selection.toString()).toContain("SidebarThreadHeader.browser.test.tsx");

  const bands = await vi.waitFor(() => {
    const found = root.querySelectorAll<HTMLElement>("[data-chat-markdown-selection-band]");
    expect(found.length).toBeGreaterThanOrEqual(3);
    return [...found];
  });

  expect(root.hasAttribute("data-chat-markdown-selection-active")).toBe(true);

  const rootWidth = root.getBoundingClientRect().width;
  // Every non-final line spans the full content column width with no gaps around inline code.
  for (const band of bands.slice(0, -1)) {
    const width = Number.parseFloat(band.style.width);
    const left = Number.parseFloat(band.style.left);
    expect(left).toBeLessThanOrEqual(1);
    expect(width).toBeGreaterThanOrEqual(rootWidth - 2);
  }

  // Consecutive bands touch seamlessly with zero vertical stripe between lines.
  for (let i = 0; i < bands.length - 1; i++) {
    const curBottom =
      Number.parseFloat(bands[i]!.style.top) + Number.parseFloat(bands[i]!.style.height);
    const nextTop = Number.parseFloat(bands[i + 1]!.style.top);
    expect(Math.abs(nextTop - curBottom)).toBeLessThanOrEqual(1);
  }

  // Collapsing the selection removes the overlay and restores native selection state.
  selection.removeAllRanges();
  document.dispatchEvent(new Event("selectionchange"));
  await vi.waitFor(() => {
    expect(root.querySelector("[data-chat-markdown-selection-overlay]")).toBeNull();
    expect(root.hasAttribute("data-chat-markdown-selection-active")).toBe(false);
  });
});
