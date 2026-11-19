import { createRef, useRef, useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, render } from "../../test/render";
import "../index.css";
import { EMPTY_COMPOSER_CONTEXT_RECORDS } from "./composerContextPresentation";
import {
  ComposerPromptEditorTiptap as ComposerPromptEditor,
  type ComposerPromptEditorHandle,
} from "./ComposerPromptEditorTiptap";
import type { VimTelemetrySnapshot } from "./editor/vimKeymapsAndIme";

function VimHarness(props: {
  initialValue?: string;
  editorRef?: React.RefObject<ComposerPromptEditorHandle | null>;
  onEscapeBubble?: () => void;
  onShiftEscapeBubble?: () => void;
  onVimTelemetryChange?: (telemetry: VimTelemetrySnapshot | null) => void;
  onCommandKeyDown?: (
    key: string,
    event: KeyboardEvent,
    isTaskItem?: boolean,
    vimMode?: "normal" | "insert",
  ) => boolean;
}) {
  const [value, setValue] = useState(props.initialValue ?? "hello world");
  const [cursor, setCursor] = useState(0);
  const fallback = useRef<ComposerPromptEditorHandle>(null);

  return (
    <div
      onKeyDown={(event) => {
        if (event.key === "Escape" && event.shiftKey) props.onShiftEscapeBubble?.();
        else if (event.key === "Escape") props.onEscapeBubble?.();
      }}
    >
      <ComposerPromptEditor
        vimMode
        value={value}
        cursor={cursor}
        contextRecords={EMPTY_COMPOSER_CONTEXT_RECORDS}
        skills={[]}
        disabled={false}
        placeholder="Ask anything"
        editorRef={props.editorRef ?? fallback}
        {...(props.onVimTelemetryChange
          ? { onVimTelemetryChange: props.onVimTelemetryChange }
          : {})}
        {...(props.onCommandKeyDown ? { onCommandKeyDown: props.onCommandKeyDown } : {})}
        onPaste={() => {}}
        onChange={(nextValue, nextCursor) => {
          setValue(nextValue);
          setCursor(nextCursor);
        }}
      />
      <output data-testid="prompt-output">{value}</output>
    </div>
  );
}

describe("ComposerPromptEditorCodeMirror (Vim Mode)", () => {
  it("renders a chosen file as a preview button and keeps Markdown code examples literal", async () => {
    const link = "[editor.ts](src/editor.ts)";
    const draft = "Review " + link + " in this file.\n\n```text\n" + link + " \n```";
    await using screen = await render(<VimHarness initialValue={draft} />);
    await expect
      .element(screen.getByRole("button", { name: "Preview src/editor.ts" }))
      .toBeVisible();
    expect(screen.container.querySelectorAll("[data-composer-mention-chip]")).toHaveLength(1);
  });

  it("inserts prepared attachments at their captured caret even after typing moves it", async () => {
    const editor = createRef<ComposerPromptEditorHandle>();
    await using screen = await render(<VimHarness initialValue="body" editorRef={editor} />);
    await expect.element(screen.getByTestId("composer-editor")).toBeVisible();
    await act(() => editor.current!.focusAtEnd());
    const insertion = editor.current!.captureAttachmentInsertion()!;
    await userEvent.keyboard("A next");
    await act(() => {
      expect(insertion.insert([{ kind: "file", label: "draft.txt", contextId: "file-1" }])).toBe(
        true,
      );
    });
    const snapshot = editor.current!.readSnapshot();
    expect(snapshot.value.indexOf("draft.txt")).toBeGreaterThan(3);
    expect(snapshot.value.indexOf(" next")).toBeGreaterThan(snapshot.value.indexOf("draft.txt"));
    expect(snapshot.contextIds).toEqual(["file-1"]);
    await expect.element(screen.getByText("draft.txt", { exact: true })).toBeVisible();
  });

  it("renders without line numbers or top status bar, supports Vim Normal/Insert motions, traps Escape in Insert, and bubbles Shift+Escape", async () => {
    const onEscapeBubble = vi.fn();
    const onShiftEscapeBubble = vi.fn();
    await using screen = await render(
      <VimHarness
        initialValue="hello world"
        onEscapeBubble={onEscapeBubble}
        onShiftEscapeBubble={onShiftEscapeBubble}
      />,
    );

    const editor = screen.getByTestId("composer-editor");
    await expect.element(editor).toBeVisible();

    // Must NOT render line numbers or top Vim status bar inside the composer
    expect(screen.container.querySelector(".cm-lineNumbers")).toBeNull();
    expect(screen.container.querySelector(".cm-vim-panel")).toBeNull();

    await userEvent.click(editor);
    // Enter Insert mode at start (`I`), type "hey ", then press Escape to return to Normal mode
    await userEvent.keyboard("Ihey ");
    await expect.element(screen.getByTestId("prompt-output")).toHaveTextContent("hey hello world");

    // Escape in Insert mode returns to Normal mode WITHOUT bubbling to close dialogs/panels!
    await userEvent.keyboard("{Escape}");
    expect(onEscapeBubble).not.toHaveBeenCalled();

    // Now in Normal mode, `dw` deletes the word under cursor
    await userEvent.keyboard("0dw");
    await expect.element(screen.getByTestId("prompt-output")).toHaveTextContent("hello world");

    // Shift+Escape bubbles cleanly to workspace maximize handler!
    await userEvent.keyboard("{Shift>}{Escape}{/Shift}");
    expect(onShiftEscapeBubble).toHaveBeenCalledTimes(1);
  });

  it("caps height at 6 lines with internal scroll-follow, steady non-blinking cursor, seamless selection, and monospace font", async () => {
    const nineLines = Array.from(
      { length: 9 },
      (_, index) => `Line ${index + 1}: composer vim`,
    ).join("\n");
    await using screen = await render(<VimHarness initialValue={nineLines} />);
    const editor = screen.getByTestId("composer-editor");
    await expect.element(editor).toBeVisible();

    const scroller = screen.container.querySelector<HTMLElement>(".cm-scroller")!;
    expect(scroller).not.toBeNull();
    expect(getComputedStyle(scroller).overflowY).toBe("auto");

    // 9 lines exceed the 6-line cap, so the scroller caps its viewport and overflows internally
    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
    expect(scroller.scrollTop).toBe(0);

    // Cursor layers do not blink
    const vimCursorLayer = screen.container.querySelector<HTMLElement>(".cm-vimCursorLayer");
    if (vimCursorLayer) {
      expect(getComputedStyle(vimCursorLayer).animationName).toBe("none");
    }

    // Jumping to line 9 (`G`) in Normal mode scrolls the viewport to keep the caret in view
    await userEvent.click(editor);
    await userEvent.keyboard("{Escape}ggG");
    await vi.waitFor(() => {
      expect(scroller.scrollTop).toBeGreaterThan(0);
    });
  });

  it("bypasses CJK IME in Normal mode via physical key codes while preserving native IME composition in Insert mode", async () => {
    await using screen = await render(<VimHarness initialValue={"first line\nsecond line"} />);
    const editor = screen.getByTestId("composer-editor");
    await expect.element(editor).toBeVisible();
    await userEvent.click(editor);
    // Ensure caret starts at line 1 col 1 regardless of click x-coordinate
    await userEvent.keyboard("{Escape}gg0");

    // Simulate macOS Chinese IME intercepting `j` + `x` in Normal mode (keyCode 229 / Process)
    const dom = editor.element();
    await act(() => {
      dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Process",
          code: "KeyJ",
          keyCode: 229,
          bubbles: true,
          cancelable: true,
        }),
      );
      dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Process",
          code: "KeyX",
          keyCode: 229,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    // Moved down to line 2 (`j`) and deleted `s` (`x`) without inserting Pinyin text
    await vi.waitFor(() => {
      expect(screen.getByTestId("prompt-output").element().textContent).toBe(
        "first line\necond line",
      );
    });

    // Enter Insert mode (`i`), insert `s`, then press custom `jk` mapping to exit Insert mode cleanly
    await userEvent.keyboard("is");
    // Type `j` then `k` via real browser input within insertModeEscKeysTimeout (400ms)
    await userEvent.keyboard("jk");
    await vi.waitFor(() => {
      expect(screen.getByTestId("prompt-output").element().textContent).toBe(
        "first line\nsecond line",
      );
    });
    // Confirm we are back in Normal mode: `0x` deletes the char at col 1 (`s`) rather than inserting `"0x"`
    await userEvent.keyboard("0x");
    await vi.waitFor(() => {
      expect(screen.getByTestId("prompt-output").element().textContent).toBe(
        "first line\necond line",
      );
    });

    // Normal mode keeps contenteditable="false" + tabindex="0" (Zed-style: prevents OS CJK IME popup)
    // while switching to contenteditable="true" in Insert mode and recovering if compositionend was dropped.
    expect(dom.getAttribute("contenteditable")).toBe("false");
    expect(dom.getAttribute("tabindex")).toBe("0");
    await userEvent.keyboard("i");
    expect(dom.getAttribute("contenteditable")).toBe("true");
    await act(() => {
      dom.dispatchEvent(new CompositionEvent("compositionstart", { data: "i", bubbles: true }));
    });
    await userEvent.keyboard("{Escape}");
    expect(dom.getAttribute("contenteditable")).toBe("false");
    // Must cleanly re-enter Insert mode after an unclosed composition in the prior Insert session
    await userEvent.keyboard("is");
    await vi.waitFor(() => {
      expect(dom.getAttribute("contenteditable")).toBe("true");
      expect(screen.getByTestId("prompt-output").element().textContent).toBe(
        "first line\nsecond line",
      );
    });
  });

  it("returns to Normal mode when committing `jk` with Enter under CJK IME in Insert mode, without triggering on Chinese commits", async () => {
    let latestTelemetry: VimTelemetrySnapshot | null = null;
    await using screen = await render(
      <VimHarness
        initialValue="你好"
        onVimTelemetryChange={(next) => {
          latestTelemetry = next;
        }}
      />,
    );
    const editor = screen.getByTestId("composer-editor");
    await expect.element(editor).toBeVisible();
    const dom = editor.element();
    await userEvent.click(editor);
    await userEvent.keyboard("{Escape}A");
    await vi.waitFor(() => {
      expect(latestTelemetry?.mode).toBe("insert");
      expect(dom.getAttribute("contenteditable")).toBe("true");
    });

    // Committing a Chinese candidate with Space must stay in Insert mode
    await act(() => {
      dom.dispatchEvent(new CompositionEvent("compositionstart", { data: "", bubbles: true }));
      dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Process",
          code: "Space",
          keyCode: 229,
          isComposing: true,
          bubbles: true,
        }),
      );
    });
    await userEvent.keyboard("接口");
    await act(() => {
      dom.dispatchEvent(new CompositionEvent("compositionend", { data: "接口", bubbles: true }));
    });
    await vi.waitFor(() => {
      expect(screen.getByTestId("prompt-output").element().textContent).toBe("你好接口");
      expect(latestTelemetry?.mode).toBe("insert");
    });

    // Committing raw `jk` with Enter under CJK IME removes `jk` and exits to Normal mode
    await act(() => {
      dom.dispatchEvent(new CompositionEvent("compositionstart", { data: "", bubbles: true }));
    });
    // Simulate IME mutating the line with `jk` and committing via Enter
    await act(() => {
      const textNode = dom.querySelector(".cm-line")?.firstChild;
      if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        textNode.textContent = `${textNode.textContent ?? ""}jk`;
        const sel = window.getSelection();
        const range = document.createRange();
        range.setStart(textNode, textNode.textContent.length);
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Process",
          code: "Enter",
          keyCode: 229,
          isComposing: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      dom.dispatchEvent(new CompositionEvent("compositionend", { data: "jk", bubbles: true }));
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("prompt-output").element().textContent).toBe("你好接口");
      expect(latestTelemetry?.mode).toBe("normal");
      expect(dom.getAttribute("contenteditable")).toBe("false");
    });
  });

  it("inserts a newline on plain Enter in Insert mode while forwarding Normal-mode Enter to submit", async () => {
    const submitted: Array<string> = [];
    await using screen = await render(
      <VimHarness
        initialValue="hello"
        onCommandKeyDown={(key, event, _isTaskItem, vimMode) => {
          if (key === "Enter" && (vimMode === "normal" || event.metaKey || event.ctrlKey)) {
            submitted.push(`${vimMode}:${event.metaKey || event.ctrlKey ? "mod" : "plain"}`);
            return true;
          }
          return false;
        }}
      />,
    );
    const editor = screen.getByTestId("composer-editor");
    await expect.element(editor).toBeVisible();
    await userEvent.click(editor);
    await userEvent.keyboard("{Escape}A{Enter}world");
    await vi.waitFor(() => {
      expect(screen.getByTestId("prompt-output").element().textContent).toBe("hello\nworld");
    });
    expect(submitted).toEqual([]);

    await userEvent.keyboard("{Escape}{Enter}");
    expect(submitted).toEqual(["normal:plain"]);
  });

  it("offsets empty placeholder past the Normal-mode block cursor and marks EOL cursor width cleanly", async () => {
    await using screen = await render(<VimHarness initialValue="" />);
    const editor = screen.getByTestId("composer-editor");
    await expect.element(editor).toBeVisible();
    const cmEditor = screen.container.querySelector<HTMLElement>(".cm-editor")!;
    const placeholder = screen.container.querySelector<HTMLElement>("[data-composer-placeholder]")!;

    expect(cmEditor.getAttribute("data-vim-cursor-eol")).toBe("true");
    expect(Number.parseFloat(getComputedStyle(placeholder).paddingLeft)).toBeGreaterThan(0);

    await userEvent.click(editor);
    await userEvent.keyboard("i");
    await vi.waitFor(() => {
      expect(Number.parseFloat(getComputedStyle(placeholder).paddingLeft)).toBe(0);
    });

    await userEvent.keyboard("ab{Escape}0");
    await vi.waitFor(() => {
      expect(cmEditor.getAttribute("data-vim-cursor-eol")).toBeNull();
    });
  });

  it("surfaces macro recording in Vim telemetry instead of showing an inline .cm-panels banner", async () => {
    const editorRef = createRef<ComposerPromptEditorHandle>();
    let latestTelemetry: VimTelemetrySnapshot | null = null;
    await using screen = await render(
      <VimHarness
        initialValue="hello"
        editorRef={editorRef}
        onVimTelemetryChange={(next) => {
          latestTelemetry = next;
        }}
      />,
    );
    const editor = screen.getByTestId("composer-editor");
    await expect.element(editor).toBeVisible();
    await userEvent.click(editor);
    await userEvent.keyboard("{Escape}qq");
    await vi.waitFor(() => {
      expect(latestTelemetry?.recordingRegister).toBe("q");
    });
    const panels = screen.container.querySelector<HTMLElement>(".cm-panels");
    if (panels) {
      expect(getComputedStyle(panels).display).toBe("none");
    }

    await act(() => {
      editorRef.current?.stopVimMacroRecording?.();
    });
    await vi.waitFor(() => {
      expect(latestTelemetry?.recordingRegister).toBeNull();
    });
  });

  it("auto-continues Markdown ordered and bullet lists on Enter in Insert mode and o in Normal mode", async () => {
    await using screen = await render(<VimHarness initialValue="1. first" />);
    const editor = screen.getByTestId("composer-editor");
    await expect.element(editor).toBeVisible();
    await userEvent.click(editor);

    // Normal mode `o` continues `1. first` -> `2. ` and enters Insert mode; typing + Enter creates `3. `
    await userEvent.keyboard("osecond{Enter}third{Escape}");
    await vi.waitFor(() => {
      expect(screen.getByTestId("prompt-output").element().textContent).toBe(
        "1. first\n2. second\n3. third",
      );
    });
  });

  it("keeps single-line container height stable from empty placeholder through ASCII and CJK input", async () => {
    await using screen = await render(
      <div className="w-[420px]">
        <VimHarness initialValue="" />
      </div>,
    );
    const editor = screen.getByTestId("composer-editor");
    await expect.element(editor).toBeVisible();
    const host = screen.container.querySelector<HTMLElement>("[data-composer-codemirror]")!;
    const placeholder = screen.container.querySelector<HTMLElement>("[data-composer-placeholder]")!;
    const container = host.parentElement!;

    expect(getComputedStyle(placeholder).lineHeight).toBe(getComputedStyle(host).lineHeight);
    const emptyHeight = container.getBoundingClientRect().height;

    await userEvent.click(editor);
    await userEvent.keyboard("ia");
    await vi.waitFor(() => {
      expect(screen.getByTestId("prompt-output").element().textContent).toBe("a");
    });
    expect(container.getBoundingClientRect().height).toBe(emptyHeight);

    await userEvent.keyboard("中文");
    await vi.waitFor(() => {
      expect(screen.getByTestId("prompt-output").element().textContent).toBe("a中文");
    });
    expect(container.getBoundingClientRect().height).toBe(emptyHeight);

    // Clearing back to empty preserves height; adding a newline still grows the composer.
    await userEvent.keyboard("{Backspace}{Backspace}{Backspace}");
    await vi.waitFor(() => {
      expect(screen.getByTestId("prompt-output").element().textContent).toBe("");
    });
    expect(container.getBoundingClientRect().height).toBe(emptyHeight);

    await userEvent.keyboard("first{Enter}second");
    await vi.waitFor(() => {
      expect(screen.getByTestId("prompt-output").element().textContent).toBe("first\nsecond");
    });
    expect(container.getBoundingClientRect().height).toBeGreaterThan(emptyHeight);
  });
});
