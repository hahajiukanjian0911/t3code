import { Annotation, MapMode } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import type { ComposerAttachmentInsertion } from "../composerAttachmentInsertion";
import {
  inlineContextReferenceReplacement,
  type ComposerContextReference,
} from "~/lib/composerContextReferences";

const insertedAttachment = Annotation.define<{ order: number; start: number; end: number }>();

function isBoundaryWhitespace(char: string | undefined): boolean {
  return char === undefined || char === " " || char === "\n" || char === "\t" || char === "\r";
}

export function composerVimAttachments(
  formatReference?: (reference: ComposerContextReference) => string,
) {
  let sequence = 0;
  const captures = new Set<(update: ViewUpdate) => void>();
  return {
    track(update: ViewUpdate) {
      for (const capture of captures) capture(update);
    },
    capture(view: EditorView, isCurrent: () => boolean): ComposerAttachmentInsertion {
      const order = ++sequence;
      let { from, to } = view.state.selection.main;
      let lost = false;
      const track = (update: ViewUpdate) => {
        for (const tr of update.transactions) {
          if (!tr.docChanged) continue;
          const earlier = tr.annotation(insertedAttachment);
          if (earlier && earlier.order < order && from === to && from === earlier.start) {
            from = to = earlier.end;
            continue;
          }
          const side = earlier && earlier.order < order ? 1 : -1;
          const start = tr.changes.mapPos(from, side, MapMode.TrackDel);
          const end = tr.changes.mapPos(to, side, MapMode.TrackDel);
          if (start === null || end === null) {
            lost = true;
            return;
          }
          from = start;
          to = end;
        }
      };
      captures.add(track);
      const dispose = () => {
        captures.delete(track);
      };
      return {
        dispose,
        insert(references) {
          dispose();
          if (lost || !isCurrent() || references.length === 0) return false;
          const doc = view.state.doc.toString();
          const edit = formatReference
            ? (() => {
                const start = Math.max(0, Math.min(doc.length, Math.floor(from)));
                const end = Math.max(start, Math.min(doc.length, Math.floor(to)));
                const needsLeadingSpace = !isBoundaryWhitespace(doc[start - 1]);
                return {
                  start,
                  end: doc[end] === " " ? end + 1 : end,
                  text: `${needsLeadingSpace ? " " : ""}${references.map(formatReference).join(" ")} `,
                };
              })()
            : inlineContextReferenceReplacement(doc, { start: from, end: to }, references);
          const insertedEnd = edit.start + edit.text.length;
          const mainSelection = view.state.selection.main;
          const moveCaretAfterInsert = mainSelection.from === from && mainSelection.to === to;
          view.dispatch({
            changes: { from: edit.start, to: edit.end, insert: edit.text },
            ...(moveCaretAfterInsert
              ? { selection: { anchor: insertedEnd }, scrollIntoView: true }
              : {}),
            userEvent: "input.paste",
            annotations: insertedAttachment.of({
              order,
              start: edit.start,
              end: insertedEnd,
            }),
          });
          return true;
        },
      };
    },
  };
}
