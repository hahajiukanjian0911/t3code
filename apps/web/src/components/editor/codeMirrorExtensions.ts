import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { selectNextOccurrence } from "@codemirror/search";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, drawSelection, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { getCM, vim } from "@replit/codemirror-vim";
import { ensureVimMarkdownListContinuation, vimNormalModeImeShield } from "./vimKeymapsAndIme";

ensureVimMarkdownListContinuation();

export const vimEditing = [
  vim({ status: false }),
  drawSelection({ cursorBlinkRate: 0 }),
  vimNormalModeImeShield,
  EditorView.editorAttributes.of((view) => {
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    const attrs: Record<string, string> = {};
    if (head === line.to) attrs["data-vim-cursor-eol"] = "true";
    if (view.state.doc.length === 0) attrs["data-vim-empty"] = "true";
    return Object.keys(attrs).length > 0 ? attrs : null;
  }),
  EditorState.transactionFilter.of((tr) => {
    if (
      tr.docChanged ||
      !tr.selection ||
      !tr.isUserEvent("select.pointer") ||
      tr.startState.facet(EditorView.editable)
    ) {
      return tr;
    }
    const main = tr.selection.main;
    if (!main.empty) return tr;
    const line = tr.startState.doc.lineAt(main.head);
    if (line.length > 0 && main.head === line.to) {
      return [tr, { selection: { anchor: line.to - 1 }, scrollIntoView: tr.scrollIntoView }];
    }
    return tr;
  }),
  Prec.highest(
    EditorView.domEventHandlers({
      keydown(event, view) {
        if (
          event.key !== "Escape" ||
          event.shiftKey ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        )
          return false;
        const mode = getCM(view)?.state.vim;
        if (mode?.insertMode || mode?.visualMode) event.stopPropagation();
        return false;
      },
    }),
  ),
];

export const codeEditing = [
  history(),
  bracketMatching(),
  closeBrackets(),
  indentOnInput(),
  EditorState.allowMultipleSelections.of(true),
  keymap.of([
    { key: "Mod-d", run: selectNextOccurrence },
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...historyKeymap,
  ]),
  syntaxHighlighting(
    HighlightStyle.define([
      {
        tag: [tags.keyword, tags.operatorKeyword, tags.modifier],
        color: "var(--primary)",
        fontWeight: "500",
      },
      { tag: [tags.heading, tags.strong], fontWeight: "600" },
      { tag: tags.emphasis, fontStyle: "italic" },
      { tag: tags.strikethrough, textDecoration: "line-through" },
      { tag: [tags.monospace, tags.url, tags.link], color: "var(--primary)" },
      { tag: [tags.string, tags.special(tags.string)], color: "var(--success)" },
      { tag: [tags.number, tags.bool, tags.atom], color: "var(--warning-foreground)" },
      {
        tag: [tags.propertyName, tags.attributeName, tags.typeName],
        color: "var(--info-foreground)",
      },
      { tag: [tags.comment, tags.quote], color: "var(--muted-foreground)", fontStyle: "italic" },
    ]),
  ),
  EditorView.theme({
    "&": { backgroundColor: "transparent", color: "inherit", fontSize: "inherit" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: "inherit", lineHeight: "inherit" },
    ".cm-content": { caretColor: "var(--foreground)" },
    ".cm-content:focus, .cm-content:focus-visible": { outline: "none" },
    ".cm-line": { padding: "0" },
    ".cm-gutters": {
      backgroundColor: "var(--code-background)",
      color: "var(--muted-foreground)",
      borderRight: "1px solid var(--border)",
    },
    ".cm-cursorLayer, &.cm-focused > .cm-scroller > .cm-cursorLayer, .cm-vimCursorLayer": {
      animation: "none !important",
    },
    ".cm-cursor": {
      borderLeftWidth: "2px",
      borderLeftColor: "var(--primary, var(--foreground))",
      marginLeft: "-1px",
    },
    ".cm-fat-cursor": {
      background: "var(--foreground) !important",
      color: "var(--popover, var(--background)) !important",
      borderRadius: "2px",
    },
    "&[data-vim-cursor-eol='true'] .cm-fat-cursor": {
      minWidth: "0.55em",
    },
    "&[data-vim-empty='true'] .cm-fat-cursor": {
      background: "color-mix(in srgb, var(--foreground) 12%, transparent) !important",
      color: "transparent !important",
      outline: "1px solid color-mix(in srgb, var(--foreground) 34%, transparent) !important",
      outlineOffset: "-1px",
    },
    "&:not(.cm-focused) .cm-fat-cursor": {
      background: "none !important",
      color: "transparent !important",
      outline: "1px solid color-mix(in srgb, var(--foreground) 34%, transparent) !important",
      outlineOffset: "-1px",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      backgroundColor: "color-mix(in srgb, var(--primary) 22%, transparent) !important",
      borderRadius: "0 !important",
    },
    ".cm-panels": {
      backgroundColor: "var(--card)",
      color: "var(--foreground)",
      borderColor: "color-mix(in srgb, var(--border) 70%, transparent)",
    },
  }),
];
