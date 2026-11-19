import { indentMore, indentLess, insertNewlineAndIndent } from "@codemirror/commands";
import { insertNewlineContinueMarkup, markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { Compartment, EditorState, Prec, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getCM, Vim } from "@replit/codemirror-vim";
import {
  COMPOSER_CONTEXT_CLIPBOARD_MIME,
  encodeComposerContextClipboardHtml,
} from "@t3tools/shared/composerContextClipboard";
import { useImperativeHandle, useLayoutEffect, useRef, useState, type ClipboardEvent } from "react";

import {
  listContinuationForEnter,
  listIndentForTab,
  listOutdentForTab,
  type ComposerListEdit,
} from "~/composer-list-continuation";
import {
  clampCollapsedComposerCursor,
  collapseExpandedComposerCursor,
  expandCollapsedComposerCursor,
} from "~/composer-logic";
import { useClientSettings } from "~/hooks/useSettings";
import { useStableCallback } from "~/hooks/useStableCallback";
import { collectInlineContextIds } from "~/lib/composerContextReferences";
import { cn } from "~/lib/utils";
import { getTimelinePageScrollKey } from "./chat/pageScrollController";
import { importPastedComposerText, readPastedComposerContext } from "./composerInlineTokenPaste";
import { didComposerSelectionChangeVisibly } from "./composerSelection";
import { ComposerContextRecordsContext } from "./composerContextPresentation";
import { composerVimAttachments } from "./editor/composerVimAttachments";
import { composerCodeNodes, inComposerNode, useComposerVimChips } from "./editor/composerVimChips";
import { codeEditing, vimEditing } from "./editor/codeMirrorExtensions";
import {
  readVimTelemetry,
  syncVimKeybindings,
  type VimTelemetrySnapshot,
} from "./editor/vimKeymapsAndIme";
import type { ComposerPromptEditorProps } from "./ComposerPromptEditorTiptap";

const textClass =
  "composer-tiptap font-(family-name:--font-composer,var(--font-mono)) text-(length:--font-size-prompt,var(--text-sm)) max-sm:pointer-coarse:text-(length:--font-size-prompt-touch) leading-normal";
const markdownExtension = markdown({ codeLanguages: languages });
const composerTheme = EditorView.theme({
  "&": {
    maxHeight: "6lh",
  },
  ".cm-content": {
    minHeight: "1lh",
    padding: "0",
  },
  ".cm-scroller": {
    minHeight: "1lh",
    maxHeight: "6lh",
    overflowY: "auto",
    overflowX: "hidden",
    scrollbarWidth: "thin",
  },
  ".cm-panels": {
    backgroundColor: "transparent",
    color: "var(--foreground)",
    borderTop: "1px solid color-mix(in srgb, var(--border) 60%, transparent)",
    marginTop: "6px",
    paddingTop: "4px",
  },
  // Non-interactive Vim status notices (e.g. `recording @q`) render in ComposerVimStatusCluster instead of expanding the editor.
  ".cm-panels:has(.cm-vim-message):not(:has(input))": {
    display: "none",
  },
  ".cm-vim-panel": {
    padding: "0",
    fontFamily: "var(--font-mono)",
    fontSize: "12px",
    lineHeight: "1.5",
    minHeight: "auto",
    alignItems: "center",
    gap: "4px",
    color: "var(--muted-foreground)",
  },
  ".cm-vim-panel input": {
    flex: "1",
    minWidth: "0",
    fontFamily: "inherit",
    fontSize: "inherit",
    color: "var(--foreground)",
    backgroundColor: "transparent",
  },
});

type Props = ComposerPromptEditorProps & {
  restoreFocusRef: React.RefObject<boolean>;
  initialExpandedCursor: number;
};

export default function ComposerPromptEditorCodeMirror(props: Props) {
  const { value, cursor, literalText = false, contextRecords, editorRef, restoreFocusRef } = props;
  const vimKeybindings = useClientSettings((settings) => settings.vimKeybindings);
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView>(null);
  const lastTelemetryRef = useRef<VimTelemetrySnapshot | null>(null);
  const current = useStableCallback(() => props);
  const chips = useComposerVimChips(props, viewRef);
  const [attachments] = useState(composerVimAttachments);
  const [attributes] = useState(() => new Compartment());
  const [isInsertMode, setIsInsertMode] = useState(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keep global CodeMirror-Vim keymap synchronized with user custom rules.
  useLayoutEffect(() => {
    syncVimKeybindings(vimKeybindings);
  }, [vimKeybindings]);

  const emitTelemetry = useStableCallback((view: EditorView | null) => {
    const cb = current().onVimTelemetryChange;
    if (!view) {
      lastTelemetryRef.current = null;
      setIsInsertMode(false);
      cb?.(null);
      return;
    }
    const next = readVimTelemetry(view);
    setIsInsertMode(next.mode === "insert");
    const prev = lastTelemetryRef.current;
    if (
      prev &&
      prev.mode === next.mode &&
      prev.line === next.line &&
      prev.column === next.column &&
      prev.pendingKeys === next.pendingKeys &&
      prev.recordingRegister === next.recordingRegister &&
      prev.notice === next.notice
    ) {
      return;
    }
    lastTelemetryRef.current = next;
    cb?.(next);
  });

  const editorAttributes = (() => {
    const { disabled, ariaLabel, activeSuggestionId, suggestionListId } = props;
    return [
      ...(disabled ? [Prec.highest(EditorView.editable.of(false))] : []),
      EditorState.readOnly.of(disabled),
      EditorView.contentAttributes.of({
        role: "textbox",
        "aria-multiline": "true",
        "data-workspace-focus-default": "",
        "data-testid": "composer-editor",
        "aria-disabled": String(disabled),
        ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
        ...(!disabled && suggestionListId
          ? {
              "aria-autocomplete": "list",
              "aria-haspopup": "listbox",
              ...(activeSuggestionId
                ? {
                    "aria-controls": suggestionListId,
                    "aria-activedescendant": activeSuggestionId,
                  }
                : {}),
            }
          : {}),
        ...(props.placeholder ? { "aria-placeholder": props.placeholder } : {}),
      }),
    ];
  })();
  const configuration = useStableCallback(() => editorAttributes);
  const snapshot = useRef({
    value,
    cursor: clampCollapsedComposerCursor(value, cursor, literalText),
    expandedCursor: props.initialExpandedCursor,
    contextIds: literalText ? [] : collectInlineContextIds(value),
  });
  const range = useRef({
    start: props.initialExpandedCursor,
    end: props.initialExpandedCursor,
  });
  const captureKey = useStableCallback((event: KeyboardEvent, view: EditorView) => {
    const { onCommandKeyDown, onPageScrollKeyDown, onPageScrollRelease, disabled } = current();
    if (["Control", "Meta", "Alt", "Shift"].includes(event.key)) onPageScrollRelease?.();
    const vimState = getCM(view)?.state.vim;
    const insert = vimState?.insertMode;
    // In Insert mode, let native CJK IME composition proceed untouched;
    // in Normal/Visual mode, vimNormalModeImeShield handles IME-hijacked physical keys.
    if (insert && (event.isComposing || event.keyCode === 229 || view.composing)) {
      if (event.key === "Enter") event.stopPropagation();
      return false;
    }
    if (
      event.key === "Escape" &&
      (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey)
    )
      return false;
    if (event.key === "PageUp" || event.key === "PageDown") {
      const { clientHeight, scrollHeight, scrollTop } = view.scrollDOM;
      const page = getTimelinePageScrollKey({
        key: event.key,
        keyCode: event.keyCode,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        isComposing: event.isComposing,
        defaultPrevented: event.defaultPrevented,
        clientHeight,
        scrollHeight,
        scrollTop,
      });
      if (onPageScrollKeyDown && page) {
        onPageScrollKeyDown(page);
        return true;
      }
    }
    if (disabled) return false;
    if (event.key === "Escape" && (insert || vimState?.visualMode)) {
      onCommandKeyDown?.("Escape", event, false, insert ? "insert" : "normal");
      event.stopPropagation();
      return false;
    }
    const pos = view.state.selection.main.from;
    const code = !literalText && inComposerNode(view.state, pos, composerCodeNodes);
    if (insert && code && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (event.key === "Tab") return (event.shiftKey ? indentLess : indentMore)(view);
      if (event.key === "Enter") return insertNewlineAndIndent(view);
    }
    const applyStandaloneListEdit = (
      fn: (doc: string, start: number, end: number) => ComposerListEdit | null,
    ) => {
      if (literalText) return false;
      const doc = view.state.doc.toString();
      const sel = view.state.selection.main;
      const edit = fn(doc, sel.from, sel.to);
      if (!edit) return false;
      view.dispatch({
        changes: { from: edit.start, to: edit.end, insert: edit.replacement },
        selection: { anchor: edit.cursorAfter },
        userEvent: "input",
        scrollIntoView: true,
      });
      event.preventDefault();
      event.stopPropagation();
      return true;
    };
    if (
      event.key === "Enter" ||
      event.key === "Escape" ||
      (insert && ["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key))
    ) {
      // Pass false for isTaskItem so composerCommandKey runs listContinuationForEnter
      // for `1.`, `-`, and `- [ ]` lists (including automatic ordered-list renumbering).
      // In Insert mode, plain Enter inserts a newline instead of submitting.
      if (onCommandKeyDown?.(event.key, event, false, insert ? "insert" : "normal")) {
        event.preventDefault();
        event.stopPropagation();
        return true;
      }
      if (insert && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (event.key === "Tab") {
          return applyStandaloneListEdit(event.shiftKey ? listOutdentForTab : listIndentForTab);
        }
        if (event.key === "Enter" && !event.shiftKey) {
          if (
            applyStandaloneListEdit((doc, from, to) =>
              from === to ? listContinuationForEnter(doc, from) : null,
            )
          ) {
            return true;
          }
        }
        if (event.key === "Enter") {
          if (!literalText && insertNewlineContinueMarkup(view)) return true;
          return insertNewlineAndIndent(view);
        }
      }
    }
    return false;
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mount and dispose the editor before the workspace hands keyboard focus to the composer.
  useLayoutEffect(() => {
    if (!host.current) return;
    const initial = current();
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initial.value,
        selection: { anchor: Math.min(initial.value.length, initial.initialExpandedCursor) },
        extensions: [
          Prec.highest(
            EditorView.domEventHandlers({
              keydown: captureKey,
              keyup(event, target) {
                current().onPageScrollKeyUp?.(event.key);
                emitTelemetry(target);
                return false;
              },
              blur() {
                current().onPageScrollRelease?.();
                return false;
              },
              paste(event, target) {
                if (
                  literalText ||
                  target.state.readOnly ||
                  !event.clipboardData ||
                  !current().importContextFragment
                )
                  return false;
                if (!readPastedComposerContext(event.clipboardData)?.records.length) return false;
                const text = importPastedComposerText(
                  event.clipboardData,
                  current().importContextFragment,
                );
                target.dispatch(target.state.replaceSelection(text), {
                  userEvent: "input.paste",
                  scrollIntoView: true,
                });
                return true;
              },
            }),
          ),
          attributes.of(configuration()),
          literalText ? [] : [markdownExtension, chips.extension],
          vimEditing,
          codeEditing,
          EditorView.lineWrapping,
          composerTheme,
          EditorView.updateListener.of((update) => {
            attachments.track(update);
            if (update.docChanged || update.selectionSet) {
              emitTelemetry(update.view);
            }
            if (!update.docChanged && !update.selectionSet) return;
            const previous = snapshot.current;
            const text = update.docChanged ? update.state.doc.toString() : previous.value;
            const { from, to } = update.state.selection.main;
            const next = {
              value: text,
              cursor: collapseExpandedComposerCursor(text, from, literalText),
              expandedCursor: from,
              contextIds:
                update.docChanged && !literalText
                  ? collectInlineContextIds(text)
                  : previous.contextIds,
            };
            const nextRange = { start: from, end: to };
            const visible = didComposerSelectionChangeVisibly(range.current, nextRange);
            range.current = nextRange;
            snapshot.current = next;
            if (update.transactions.some((tr) => tr.annotation(Transaction.remote))) return;
            if (!update.docChanged && text !== current().value) return;
            if (previous.value !== text || previous.expandedCursor !== from) {
              const before = update.state.field(chips.extension, false);
              let adjacent = false;
              before?.between(from, from, (_from, end) => {
                if (end === from) adjacent = true;
              });
              current().onChange(
                text,
                next.cursor,
                from,
                literalText || adjacent || inComposerNode(update.state, from, composerCodeNodes),
                next.contextIds,
              );
            } else if (visible) current().onVisibleSelectionChange?.();
          }),
        ],
      }),
    });
    viewRef.current = view;
    const cm = getCM(view);
    const onVimEvent = () => emitTelemetry(view);
    cm?.on("vim-mode-change", onVimEvent);
    cm?.on("vim-keypress", onVimEvent);
    cm?.on("vim-command-done", onVimEvent);
    cm?.on("dialog", onVimEvent);
    emitTelemetry(view);

    if (restoreFocusRef.current) {
      restoreFocusRef.current = false;
      view.focus();
    }
    return () => {
      cm?.off("vim-mode-change", onVimEvent);
      cm?.off("vim-keypress", onVimEvent);
      cm?.off("vim-command-done", onVimEvent);
      cm?.off("dialog", onVimEvent);
      restoreFocusRef.current = view.hasFocus;
      viewRef.current = null;
      view.destroy();
    };
  }, [
    attachments,
    attributes,
    captureKey,
    chips.extension,
    configuration,
    current,
    emitTelemetry,
    literalText,
    restoreFocusRef,
  ]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- permissions and the active suggestion list change the native editable element's attributes.
  useLayoutEffect(() => {
    viewRef.current?.dispatch({ effects: attributes.reconfigure(editorAttributes) });
  }, [attributes, editorAttributes]);

  const saveDraftBeforeReplace = chips.saveDraftBeforeReplace;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- apply external rewrites such as draft restoration, suggestion insertion and sending.
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const before = snapshot.current;
    if (before.value === value && before.cursor === cursor) return;
    if (before.value !== value) saveDraftBeforeReplace(before.value, value);
    const head = expandCollapsedComposerCursor(value, cursor, literalText);
    view.dispatch({
      ...(before.value !== value
        ? { changes: { from: 0, to: view.state.doc.length, insert: value } }
        : {}),
      selection: { anchor: head },
      scrollIntoView: view.hasFocus,
      annotations: [Transaction.remote.of(true), Transaction.addToHistory.of(false)],
    });
  }, [cursor, value, literalText, saveDraftBeforeReplace]);

  const focusAt = (head: number) => {
    const view = viewRef.current;
    if (!view) return;
    view.focus();
    if (snapshot.current.value === current().value)
      view.dispatch({
        selection: { anchor: Math.min(head, view.state.doc.length) },
        scrollIntoView: true,
      });
  };
  useImperativeHandle(editorRef, () => ({
    focus: () => focusAt(snapshot.current.expandedCursor),
    focusAt: (offset) =>
      focusAt(expandCollapsedComposerCursor(snapshot.current.value, offset, literalText)),
    focusAtEnd: () => focusAt(snapshot.current.value.length),
    readSelectionRange: () => range.current,
    readSnapshot: () => snapshot.current,
    captureAttachmentInsertion: () => {
      const view = viewRef.current;
      return view && !literalText
        ? attachments.capture(view, () => view === viewRef.current)
        : undefined;
    },
    requestCitationComment: chips.requestCitationComment,
    isCaretOnVisualEdge: (edge) => {
      const view = viewRef.current;
      if (!view || !view.state.doc.length) return true;
      const selection = view.state.selection.main;
      if (!selection.empty) return false;
      const end = edge === "end";
      const boundary = view.moveToLineBoundary(selection, end, true);
      return boundary.head === (end ? view.state.doc.length : 0);
    },
    stopVimMacroRecording: () => {
      const view = viewRef.current;
      const cm = view ? getCM(view) : null;
      if (!view || !cm) return;
      Vim.handleKey(cm, "q", "user");
      emitTelemetry(view);
      view.focus();
    },
  }));
  const copy = (event: ClipboardEvent, cut: boolean) => {
    const view = viewRef.current;
    if (literalText || !view || (cut && view.state.readOnly)) return;
    const text = view.state.selection.ranges
      .map((r) => view.state.sliceDoc(r.from, r.to))
      .join("\n");
    const ids = collectInlineContextIds(text);
    const fragment = ids.length ? props.buildContextClipboardFragment?.(ids) : null;
    if (!fragment) return;
    event.preventDefault();
    event.stopPropagation();
    event.clipboardData.setData("text/plain", text);
    event.clipboardData.setData(COMPOSER_CONTEXT_CLIPBOARD_MIME, fragment);
    event.clipboardData.setData("text/html", encodeComposerContextClipboardHtml(text, fragment));
    if (cut) view.dispatch(view.state.replaceSelection(""), { userEvent: "delete.cut" });
  };
  return (
    <ComposerContextRecordsContext value={contextRecords}>
      <div
        className={cn("relative flow-root", props.containerClassName)}
        onPasteCapture={props.onPaste}
        onCopyCapture={(event) => copy(event, false)}
        onCutCapture={(event) => copy(event, true)}
      >
        <div
          ref={host}
          data-composer-codemirror=""
          data-composer-markdown={literalText ? undefined : "true"}
          className={cn(textClass, props.className)}
        />
        {value.length === 0 && contextRecords.size === 0 && props.placeholder ? (
          <div
            data-composer-codemirror=""
            data-composer-placeholder=""
            style={isInsertMode ? undefined : { paddingInlineStart: "calc(0.55em + 4px)" }}
            className={cn(
              textClass,
              "pointer-events-none absolute inset-0 truncate text-placeholder",
              props.placeholderClassName,
            )}
          >
            {props.placeholder}
            {props.placeholderSuffix}
          </div>
        ) : null}
        {chips.portals}
      </div>
    </ComposerContextRecordsContext>
  );
}
