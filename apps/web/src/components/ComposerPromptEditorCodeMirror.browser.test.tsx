import { createRef, useRef, useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, render } from "../../test/render";
import { EMPTY_COMPOSER_CONTEXT_RECORDS } from "./composerContextPresentation";
import {
  ComposerPromptEditorTiptap as ComposerPromptEditor,
  type ComposerPromptEditorHandle,
} from "./ComposerPromptEditorTiptap";

function VimHarness(props: {
  initialValue?: string;
  editorRef?: React.RefObject<ComposerPromptEditorHandle | null>;
  onEscapeBubble?: () => void;
  onShiftEscapeBubble?: () => void;
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
});
