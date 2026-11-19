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
import {
  collectInlineContextIds,
  formatInlineContextReference,
  type ComposerContextReference,
} from "~/lib/composerContextReferences";
import { collectComposerPromptInlineTokens } from "~/composer-editor-mentions";
import { cn } from "~/lib/utils";
import { getTimelinePageScrollKey } from "./chat/pageScrollController";
import { importPastedComposerText, readPastedComposerContext } from "./composerInlineTokenPaste";
import { didComposerSelectionChangeVisibly } from "./composerSelection";
import { ComposerContextRecordsContext } from "./composerContextPresentation";
import {
  decodeEditorImageTokens,
  encodeEditorImageTokens,
  nextAvailableImageAlias,
  type EditorImageAliasBinding,
} from "./editor/composerImageTokens";
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
  const knownAliasesRef = useRef<Map<string, EditorImageAliasBinding>>(new Map());
  const current = useStableCallback(() => props);
  const formatAttachmentReference = useStableCallback((reference: ComposerContextReference) => {
    const canonicalSource = formatInlineContextReference(reference);
    if (current().literalText || reference.kind !== "image") {
      return canonicalSource;
    }
    for (const [existingAlias, binding] of knownAliasesRef.current) {
      if (binding.contextId === reference.contextId) {
        return existingAlias;
      }
    }
    const currentDoc = viewRef.current?.state.doc.toString() ?? "";
    const alias = nextAvailableImageAlias(knownAliasesRef.current, currentDoc);
    knownAliasesRef.current.set(alias, {
      alias,
      contextId: reference.contextId,
      canonicalSource,
    });
    return alias;
  });
  const encodePastedCanonicalText = useStableCallback((canonical: string) => {
    if (current().literalText) return canonical;
    const imageTokens = collectComposerPromptInlineTokens(canonical).filter(
      (
        token,
      ): token is Extract<
        ReturnType<typeof collectComposerPromptInlineTokens>[number],
        { type: "context-reference" }
      > => token.type === "context-reference" && token.kind === "image",
    );
    if (imageTokens.length === 0) return canonical;
    let cursorPos = 0;
    let output = "";
    for (const token of imageTokens) {
      output += canonical.slice(cursorPos, token.start);
      output += formatAttachmentReference({
        kind: "image",
        contextId: token.contextId,
        label: token.label,
      });
      cursorPos = token.end;
    }
    output += canonical.slice(cursorPos);
    return output;
  });
  const chips = useComposerVimChips(props, viewRef, knownAliasesRef);
  const [attachments] = useState(() => composerVimAttachments(formatAttachmentReference));
  const [attributes] = useState(() => new Compartment());

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keep global CodeMirror-Vim keymap synchronized with user custom rules.
  useLayoutEffect(() => {
    syncVimKeybindings(vimKeybindings);
  }, [vimKeybindings]);

  const emitTelemetry = useStableCallback((view: EditorView | null) => {
    const cb = current().onVimTelemetryChange;
    if (!view) {
      lastTelemetryRef.current = null;
      cb?.(null);
      return;
    }
    const next = readVimTelemetry(view);
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
    const initialEncoded = literalText ? null : encodeEditorImageTokens(initial.value);
    knownAliasesRef.current = new Map(initialEncoded?.aliasToBinding ?? []);
    const initialDisplayDoc = initialEncoded ? initialEncoded.displayText : initial.value;
    const clampedInitialCanonicalHead = Math.min(
      initial.value.length,
      initial.initialExpandedCursor,
    );
    const initialDisplayHead = initialEncoded
      ? initialEncoded.mapCanonicalToDisplay(clampedInitialCanonicalHead)
      : clampedInitialCanonicalHead;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initialDisplayDoc,
        selection: { anchor: Math.min(initialDisplayDoc.length, initialDisplayHead) },
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
                const displayPasted = encodePastedCanonicalText(text);
                target.dispatch(target.state.replaceSelection(displayPasted), {
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
            const displayText = update.state.doc.toString();
            const decoded = literalText
              ? null
              : decodeEditorImageTokens(displayText, knownAliasesRef.current);
            const text = update.docChanged
              ? decoded
                ? decoded.canonicalText
                : displayText
              : previous.value;
            const { from: displayFrom, to: displayTo } = update.state.selection.main;
            const from = decoded ? decoded.mapDisplayToCanonical(displayFrom) : displayFrom;
            const to = decoded ? decoded.mapDisplayToCanonical(displayTo) : displayTo;
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
            const isRemote = update.transactions.some((tr) => tr.annotation(Transaction.remote));
            if (isRemote) return;
            if (!update.docChanged && text !== current().value) return;
            if (previous.value !== text || previous.expandedCursor !== from) {
              const before = update.state.field(chips.extension, false);
              let adjacent = false;
              before?.between(displayFrom, displayFrom, (_from, end) => {
                if (end === displayFrom) adjacent = true;
              });
              current().onChange(
                text,
                next.cursor,
                from,
                literalText ||
                  adjacent ||
                  inComposerNode(update.state, displayFrom, composerCodeNodes),
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

    let mountScrollFrameId: number | null = null;
    if (initialDisplayHead > 0) {
      view.dispatch({
        effects: EditorView.scrollIntoView(Math.min(initialDisplayDoc.length, initialDisplayHead), {
          y: "nearest",
        }),
        annotations: [Transaction.remote.of(true), Transaction.addToHistory.of(false)],
      });
      mountScrollFrameId = requestAnimationFrame(() => {
        mountScrollFrameId = null;
        if (viewRef.current === view && view.dom.isConnected) {
          view.dispatch({
            effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: "nearest" }),
            annotations: [Transaction.remote.of(true), Transaction.addToHistory.of(false)],
          });
        }
      });
    }

    if (restoreFocusRef.current) {
      restoreFocusRef.current = false;
      view.focus();
    }
    return () => {
      if (mountScrollFrameId !== null) cancelAnimationFrame(mountScrollFrameId);
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
    encodePastedCanonicalText,
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
    const canonicalHead = expandCollapsedComposerCursor(value, cursor, literalText);
    const encoded = literalText ? null : encodeEditorImageTokens(value, knownAliasesRef.current);
    if (encoded && before.value !== value) {
      knownAliasesRef.current = new Map(encoded.aliasToBinding);
    }
    const nextDisplayDoc = encoded ? encoded.displayText : value;
    const nextDisplayHead = Math.min(
      nextDisplayDoc.length,
      encoded ? encoded.mapCanonicalToDisplay(canonicalHead) : canonicalHead,
    );
    const currentDisplayDoc = view.state.doc.toString();
    view.dispatch({
      ...(currentDisplayDoc !== nextDisplayDoc
        ? { changes: { from: 0, to: currentDisplayDoc.length, insert: nextDisplayDoc } }
        : {}),
      selection: { anchor: nextDisplayHead },
      effects: EditorView.scrollIntoView(nextDisplayHead, { y: "nearest" }),
      annotations: [Transaction.remote.of(true), Transaction.addToHistory.of(false)],
    });
    if (before.value !== value && nextDisplayHead > 0) {
      const frameId = requestAnimationFrame(() => {
        if (viewRef.current === view && view.dom.isConnected) {
          view.dispatch({
            effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: "nearest" }),
            annotations: [Transaction.remote.of(true), Transaction.addToHistory.of(false)],
          });
        }
      });
      return () => cancelAnimationFrame(frameId);
    }
    return undefined;
  }, [cursor, value, literalText, saveDraftBeforeReplace]);

  const focusAt = (head: number) => {
    const view = viewRef.current;
    if (!view) return;
    view.focus();
    if (snapshot.current.value === current().value) {
      const displayHead = literalText
        ? head
        : encodeEditorImageTokens(
            snapshot.current.value,
            knownAliasesRef.current,
          ).mapCanonicalToDisplay(head);
      view.dispatch({
        selection: { anchor: Math.min(displayHead, view.state.doc.length) },
        scrollIntoView: true,
      });
    }
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
    const displayText = view.state.selection.ranges
      .map((r) => view.state.sliceDoc(r.from, r.to))
      .join("\n");
    const text = decodeEditorImageTokens(displayText, knownAliasesRef.current).canonicalText;
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
