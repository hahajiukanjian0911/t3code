import { LanguageDescription, type LanguageSupport } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { searchKeymap } from "@codemirror/search";
import { StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type DecorationSet,
  type BlockInfo,
} from "@codemirror/view";
import type { SelectedLineRange } from "@pierre/diffs";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CodeMirrorSurface } from "../editor/CodeMirrorSurface";
import { useStableCallback } from "~/hooks/useStableCallback";
import type { FileCommentLineAnnotation } from "./fileCommentAnnotations";

export interface FileEditorPosition {
  scroll: ReturnType<EditorView["scrollSnapshot"]>;
  caret: number;
  revealRequestId: number;
  revealLine: number | null;
}

class CommentWidget extends WidgetType {
  constructor(readonly host: HTMLElement) {
    super();
  }
  override eq(other: CommentWidget) {
    return this.host === other.host;
  }
  toDOM() {
    return this.host;
  }
}

const setComments = StateEffect.define<DecorationSet>();
const comments = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    return (
      transaction.effects.find((effect) => effect.is(setComments))?.value ??
      value.map(transaction.changes)
    );
  },
  provide: (field) => EditorView.decorations.from(field),
});

const jumpToLine = StateEffect.define<number | null>();
const linkedLine = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    const reveal = transaction.effects.find((effect) => effect.is(jumpToLine));
    if (!reveal) return value.map(transaction.changes);
    return reveal.value === null
      ? Decoration.none
      : Decoration.set([
          Decoration.line({
            class: "bg-accent",
            attributes: { "data-file-link-reveal": "" },
          }).range(reveal.value),
        ]);
  },
  provide: (field) => EditorView.decorations.from(field),
});

export default function VimFileEditor(props: {
  path: string;
  contents: string;
  wordWrap: boolean;
  revealLine: number | null;
  revealRequestId: number;
  positions: Map<string, FileEditorPosition>;
  annotations: ReadonlyArray<FileCommentLineAnnotation>;
  onBeginComment: (range: SelectedLineRange) => void;
  renderAnnotation: (annotation: FileCommentLineAnnotation) => ReactNode;
  onEdit: (text: string, annotations?: ReadonlyArray<FileCommentLineAnnotation>) => void;
  onFocusReady: (focus: (() => void) | null) => void;
}) {
  const { path, contents, wordWrap, revealLine, revealRequestId, positions, annotations } = props;
  const viewRef = useRef<EditorView>(null);
  const [language, setLanguage] = useState<LanguageSupport>();
  const gutterDrag = useRef<AbortController>(null);
  const [hosts, setHosts] = useState<Map<string, HTMLElement>>(() => new Map());
  const current = useStableCallback(() => props);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- load only the grammar selected by the file extension.
  useEffect(() => {
    let active = true;
    const grammar = LanguageDescription.matchFilename(languages, path.split("/").at(-1) ?? path);
    void grammar?.load().then(
      (support) => {
        if (active) setLanguage(support);
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [path]);

  const startComment = useStableCallback((view: EditorView, block: BlockInfo, event: Event) => {
    if (
      !(event instanceof MouseEvent) ||
      event.button !== 0 ||
      current().annotations.some((a) => a.metadata.entries.some((e) => e.kind === "draft"))
    )
      return false;
    const start = view.state.doc.lineAt(block.from).number;
    const onRelease = (release: MouseEvent) => {
      const pos = view.posAtCoords(
        { x: view.contentDOM.getBoundingClientRect().left + 1, y: release.clientY },
        false,
      );
      current().onBeginComment({ start, end: view.state.doc.lineAt(pos).number });
    };
    gutterDrag.current?.abort();
    const controller = new AbortController();
    gutterDrag.current = controller;
    view.dom.ownerDocument.addEventListener(
      "mouseup",
      (event) => {
        controller.abort();
        if (view.dom.isConnected) onRelease(event);
      },
      { once: true, signal: controller.signal },
    );
    view.dom.ownerDocument.defaultView?.addEventListener("blur", () => controller.abort(), {
      once: true,
      signal: controller.signal,
    });
    event.preventDefault();
    return true;
  });
  const [extras] = useState(() => [
    keymap.of(searchKeymap),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    comments,
    linkedLine,
    lineNumbers({ domEventHandlers: { mousedown: startComment } }),
  ]);

  const restoreOrReveal = useStableCallback((view: EditorView, mounting: boolean) => {
    const saved = positions.get(path);
    const restore =
      mounting &&
      saved &&
      saved.revealRequestId === revealRequestId &&
      saved.revealLine === revealLine;
    const line =
      revealLine === null
        ? null
        : view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, revealLine)));
    const head = restore ? Math.min(saved.caret, view.state.doc.length) : line?.from;
    view.dispatch({
      ...(head !== undefined ? { selection: { anchor: head } } : {}),
      effects: [
        jumpToLine.of(line?.from ?? null),
        ...(restore
          ? [saved.scroll]
          : line
            ? [EditorView.scrollIntoView(line.from, { y: "center" })]
            : []),
      ],
    });
  });
  const lastReveal = useRef<{ line: number | null; id: number } | null>(null);
  const onViewChange = (view: EditorView | null) => {
    gutterDrag.current?.abort();
    const old = viewRef.current;
    if (old && lastReveal.current) {
      positions.set(path, {
        caret: old.state.selection.main.head,
        scroll: old.scrollSnapshot(),
        revealLine: lastReveal.current.line,
        revealRequestId: lastReveal.current.id,
      });
    }
    viewRef.current = view;
    if (view) {
      restoreOrReveal(view, true);
      lastReveal.current = { line: revealLine, id: revealRequestId };
    }
    props.onFocusReady(view ? () => view.focus() : null);
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a new link to the same open file must move the existing editor.
  useLayoutEffect(() => {
    if (lastReveal.current?.line === revealLine && lastReveal.current?.id === revealRequestId)
      return;
    if (viewRef.current) restoreOrReveal(viewRef.current, false);
    lastReveal.current = { line: revealLine, id: revealRequestId };
  }, [revealLine, revealRequestId, restoreOrReveal]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- anchor React's review forms to the current document lines.
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const nextHosts = new Map<string, HTMLElement>();
    const decorations = annotations.flatMap((annotation) => {
      const id = annotation.metadata.entries[0]?.id;
      if (!id) return [];
      const host = hosts.get(id) ?? document.createElement("div");
      nextHosts.set(id, host);
      const line = view.state.doc.line(
        Math.max(1, Math.min(annotation.lineNumber, view.state.doc.lines)),
      );
      return [
        Decoration.widget({ widget: new CommentWidget(host), block: true, side: 1 }).range(line.to),
      ];
    });
    view.dispatch({ effects: setComments.of(Decoration.set(decorations, true)) });
    if (hosts.size !== nextHosts.size || [...nextHosts.keys()].some((id) => !hosts.has(id)))
      // oxlint-disable-next-line react/set-state-in-effect -- React portals need the hosts created for the committed CodeMirror document.
      setHosts(nextHosts);
  }, [annotations, hosts]);

  return (
    <>
      <CodeMirrorSurface
        value={contents}
        onChange={(text, update) => {
          const moved = annotations.map((annotation) => {
            const before = update.startState.doc.line(
              Math.min(annotation.lineNumber, update.startState.doc.lines),
            );
            const number = update.state.doc.lineAt(update.changes.mapPos(before.from, 1)).number;
            return number === annotation.lineNumber
              ? annotation
              : { ...annotation, lineNumber: number };
          });
          props.onEdit(
            text,
            moved.some((annotation, index) => annotation !== annotations[index])
              ? moved
              : undefined,
          );
        }}
        onViewChange={onViewChange}
        languageExtension={language}
        extensions={extras}
        ariaLabel={path}
        vimEnabled
        wordWrap={wordWrap}
        className="min-h-0 flex-1 overflow-hidden bg-code font-mono text-xs leading-5"
      />
      {annotations.map((annotation) => {
        const id = annotation.metadata.entries[0]?.id;
        const host = id && hosts.get(id);
        return host ? createPortal(props.renderAnnotation(annotation), host, id) : null;
      })}
    </>
  );
}
