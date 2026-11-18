import { Annotation, MapMode } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import type { ComposerAttachmentInsertion } from "../composerAttachmentInsertion";
import { inlineContextReferenceReplacement } from "~/lib/composerContextReferences";

const insertedAttachment = Annotation.define<{ order: number; start: number; end: number }>();

export function composerVimAttachments() {
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
          const edit = inlineContextReferenceReplacement(
            view.state.doc.toString(),
            { start: from, end: to },
            references,
          );
          view.dispatch({
            changes: { from: edit.start, to: edit.end, insert: edit.text },
            userEvent: "input.paste",
            annotations: insertedAttachment.of({
              order,
              start: edit.start,
              end: edit.start + edit.text.length,
            }),
          });
          return true;
        },
      };
    },
  };
}
