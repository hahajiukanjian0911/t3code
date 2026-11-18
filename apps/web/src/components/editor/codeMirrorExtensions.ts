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

export const vimEditing = [
  vim({ status: false }),
  drawSelection(),
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
    ".cm-line": { padding: "0" },
    ".cm-gutters": {
      backgroundColor: "var(--code-background)",
      color: "var(--muted-foreground)",
      borderRight: "1px solid var(--border)",
    },
    ".cm-cursor": { borderLeftColor: "var(--foreground)" },
    ".cm-fat-cursor": {
      background: "var(--foreground) !important",
      color: "var(--background) !important",
    },
    "&:not(.cm-focused) .cm-fat-cursor": {
      background: "none !important",
      outline: "1px solid var(--muted-foreground) !important",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      backgroundColor: "color-mix(in srgb, var(--primary) 24%, transparent)",
    },
    ".cm-panels": { backgroundColor: "var(--card)", color: "var(--foreground)" },
  }),
];
