import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import "../../index.css";
import ChatMarkdown from "../ChatMarkdown";

it("selects draggable file links and paints continuous full-line selection without shifting layout height", async () => {
  const markdown = [
    "### 覆盖面与验证",
    "",
    '- 新增 [SidebarThreadHeader.browser.test.tsx](file:///tmp/SidebarThreadHeader.browser.test.tsx#L1-L115)，覆盖 `inert` 与 `type="text"`。',
    "- 同步更新 `vp test run` (`SidebarThreadHeader.browser.test.tsx` + `Sidebar.drag.browser.test.tsx`)。",
    "",
    "结尾段落需要保持末行间距不变。",
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

  const wrapper = root.parentElement!;
  const lastParagraph = root.querySelector<HTMLParagraphElement>("p:last-child")!;
  const heightBefore = wrapper.getBoundingClientRect().height;
  const childCountBefore = root.childElementCount;
  expect(getComputedStyle(lastParagraph).marginBottom).toBe("0px");

  const range = document.createRange();
  range.selectNodeContents(root);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));

  expect(selection.toString()).toContain("SidebarThreadHeader.browser.test.tsx");

  await vi.waitFor(() => {
    expect(root.hasAttribute("data-chat-markdown-selection-active")).toBe(true);
  });

  // Selection rendering must never mutate markdown children or break p:last-child margin-bottom.
  expect(root.childElementCount).toBe(childCountBefore);
  expect(getComputedStyle(lastParagraph).marginBottom).toBe("0px");
  expect(wrapper.getBoundingClientRect().height).toBe(heightBefore);

  // Verify the ::after mask carries the SVG geometry and clears cleanly on collapse.
  expect(root.style.getPropertyValue("--chat-markdown-selection-mask")).toContain(
    "data:image/svg+xml",
  );

  // Selecting a single list item from its beginning covers its leading bullet marker (left = 0).
  const firstListItem = root.querySelector("li")!;
  const itemRange = document.createRange();
  itemRange.selectNodeContents(firstListItem);
  selection.removeAllRanges();
  selection.addRange(itemRange);
  document.dispatchEvent(new Event("selectionchange"));
  await vi.waitFor(() => {
    const mask = decodeURIComponent(root.style.getPropertyValue("--chat-markdown-selection-mask"));
    expect(mask).toContain("M3 ");
  });

  selection.removeAllRanges();
  document.dispatchEvent(new Event("selectionchange"));
  await vi.waitFor(() => {
    expect(root.hasAttribute("data-chat-markdown-selection-active")).toBe(false);
  });
  expect(root.style.getPropertyValue("--chat-markdown-selection-mask")).toBe("");
  expect(root.style.getPropertyValue("--chat-markdown-selection-mask-size")).toBe("");
  expect(wrapper.getBoundingClientRect().height).toBe(heightBefore);
});

it("keeps selection aligned when markdown height grows and its container scrolls", async () => {
  const initialMarkdown = ["- 第一条需要选中的关键结论文本。", "- 第二条普通说明文本。"].join("\n");
  const appendedMarkdown = [
    initialMarkdown,
    "- 第三条后续流式追加的说明文本。",
    "- 第四条后续流式追加的说明文本。",
    "- 第五条后续流式追加的说明文本。",
    "",
    "追加的总结段落，拉高整个消息容器。",
  ].join("\n");

  await using screen = await render(
    <div className="h-[140px] w-[420px] overflow-y-auto p-4" data-testid="scroller">
      <ChatMarkdown
        text={initialMarkdown}
        cwd="/tmp"
        environmentId={EnvironmentId.make("env-sel-scroll")}
      />
    </div>,
  );

  const scroller = screen.container.querySelector<HTMLElement>('[data-testid="scroller"]')!;
  const root = screen.container.querySelector<HTMLElement>(".chat-markdown")!;
  const firstListItem = root.querySelector("li")!;
  const range = document.createRange();
  range.selectNodeContents(firstListItem);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));

  await vi.waitFor(() => {
    expect(root.style.getPropertyValue("--chat-markdown-selection-mask-size")).not.toBe("");
  });
  const initialSize = root.style.getPropertyValue("--chat-markdown-selection-mask-size");
  const initialMask = decodeURIComponent(
    root.style.getPropertyValue("--chat-markdown-selection-mask"),
  );
  const initialHeightMatch = /height="([\d.]+)"/.exec(initialMask);
  expect(initialHeightMatch).not.toBeNull();

  await screen.rerender(
    <div className="h-[140px] w-[420px] overflow-y-auto p-4" data-testid="scroller">
      <ChatMarkdown
        text={appendedMarkdown}
        cwd="/tmp"
        environmentId={EnvironmentId.make("env-sel-scroll")}
      />
    </div>,
  );
  scroller.scrollTop = scroller.scrollHeight;
  scroller.dispatchEvent(new Event("scroll"));

  await vi.waitFor(() => {
    expect(root.style.getPropertyValue("--chat-markdown-selection-mask-size")).not.toBe(
      initialSize,
    );
  });
  const updatedMask = decodeURIComponent(
    root.style.getPropertyValue("--chat-markdown-selection-mask"),
  );
  const updatedHeightMatch = /height="([\d.]+)"/.exec(updatedMask);
  expect(Number(updatedHeightMatch?.[1])).toBeGreaterThan(Number(initialHeightMatch?.[1]));
  expect(root.style.getPropertyValue("--chat-markdown-selection-mask-size")).toContain(
    `${updatedHeightMatch?.[1]}px`,
  );
});
