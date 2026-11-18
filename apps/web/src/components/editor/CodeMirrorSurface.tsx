import { indentWithTab } from "@codemirror/commands";
import { Compartment, Prec, Transaction, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, type ViewUpdate } from "@codemirror/view";
import { getCM } from "@replit/codemirror-vim";
import { useLayoutEffect, useRef, useState } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { cn } from "~/lib/utils";
import { codeEditing, vimEditing } from "./codeMirrorExtensions";

// CodeMirror normalizes line breaks. Replay the edits against the source so untouched lines keep their original endings.
function changedText(source: string, update: ViewUpdate): string {
  if (!source.includes("\r")) return update.state.doc.toString();
  const starts = [0];
  for (const match of source.matchAll(/\r\n|\r|\n/g)) starts.push(match.index + match[0].length);
  const offset = (pos: number) => {
    const line = update.startState.doc.lineAt(pos);
    return starts[line.number - 1]! + pos - line.from;
  };
  const separator = source.match(/\r\n|\r|\n/)![0];
  const chunks: string[] = [];
  let end = 0;
  update.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
    chunks.push(
      source.slice(end, offset(from)),
      inserted.sliceString(0, inserted.length, separator),
    );
    end = offset(to);
  });
  return chunks.join("") + source.slice(end);
}

interface CodeMirrorSurfaceProps {
  value: string;
  onChange: (text: string, update: ViewUpdate) => void;
  languageExtension?: Extension | undefined;
  extensions?: Extension;
  wordWrap?: boolean;
  vimEnabled: boolean;
  tabIndents?: boolean;
  ariaLabel: string;
  ariaDescribedBy?: string;
  className?: string;
  onViewChange?: (view: EditorView | null) => void;
  onFocus?: () => void;
  onPositionChange?: (pos: { line: number; column: number }) => void;
  onVimModeChange?: (mode: string) => void;
  onEscapeTabTrap?: () => void;
}

const externalChange = Transaction.remote.of(true);
const editorTheme = EditorView.theme({
  "&": { height: "100%" },
  ".cm-scroller": { overflow: "auto" },
  ".cm-content": { padding: "10px 12px" },
});

export function CodeMirrorSurface(props: CodeMirrorSurfaceProps) {
  const { value, extensions, vimEnabled, wordWrap, languageExtension, tabIndents = true } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView>(null);
  const source = useRef(value);
  const current = useStableCallback(() => props);
  const [config] = useState(() => new Compartment());
  const options = [
    vimEnabled ? vimEditing : [],
    tabIndents ? keymap.of([indentWithTab]) : [],
    wordWrap ? EditorView.lineWrapping : [],
    languageExtension ?? [],
    extensions ?? [],
  ];
  const configuration = useStableCallback(() => options);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- CodeMirror owns its editable DOM and selection.
  useLayoutEffect(() => {
    if (!hostRef.current) return;
    source.current = current().value;
    const view = new EditorView({
      parent: hostRef.current,
      doc: source.current,
      extensions: [
        Prec.highest(
          EditorView.domEventHandlers({
            focus() {
              current().onFocus?.();
              return false;
            },
            keydown(event, editor) {
              if (
                event.key !== "Escape" ||
                event.shiftKey ||
                event.altKey ||
                event.ctrlKey ||
                event.metaKey
              )
                return false;
              const { onEscapeTabTrap } = current();
              const mode = getCM(editor)?.state.vim;
              if (!onEscapeTabTrap || mode?.insertMode || mode?.visualMode) return false;
              event.stopPropagation();
              onEscapeTabTrap();
              return true;
            },
          }),
        ),
        config.of(configuration()),
        lineNumbers(),
        codeEditing,
        editorTheme,
        EditorView.contentAttributes.of({
          "aria-label": current().ariaLabel,
          ...(current().ariaDescribedBy ? { "aria-describedby": current().ariaDescribedBy! } : {}),
          autocapitalize: "off",
          autocomplete: "off",
          autocorrect: "off",
          spellcheck: "false",
        }),
        EditorView.updateListener.of((update) => {
          if (
            update.docChanged &&
            !update.transactions.some((tr) => tr.annotation(Transaction.remote))
          ) {
            source.current = changedText(source.current, update);
            current().onChange(source.current, update);
          }
          if (update.selectionSet || update.docChanged) {
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head);
            current().onPositionChange?.({ line: line.number, column: head - line.from + 1 });
          }
        }),
      ],
    });
    viewRef.current = view;
    current().onViewChange?.(view);
    return () => {
      current().onViewChange?.(null);
      viewRef.current = null;
      view.destroy();
    };
  }, [config, configuration, current]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- update language, wrap and keymaps without replacing the document or undo history.
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: config.reconfigure(options) });
    const cm = getCM(view);
    if (!cm || !current().onVimModeChange) return;
    const report = () => current().onVimModeChange?.(cm.state.vim?.mode ?? "normal");
    report();
    cm.on("vim-mode-change", report);
    return () => cm.off("vim-mode-change", report);
  }, [config, current, options]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- external file revisions and Clear CSS can replace the controlled text.
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view || value === source.current) return;
    source.current = value;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      annotations: [externalChange, Transaction.addToHistory.of(false)],
    });
  }, [value]);

  return <div ref={hostRef} className={cn("min-h-0 min-w-0", props.className)} />;
}
