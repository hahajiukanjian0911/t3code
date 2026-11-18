import { syntaxTree } from "@codemirror/language";
import { StateEffect, StateField, Transaction, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import type { ServerProviderSkill } from "@t3tools/contracts";
import { formatProviderSkillDisplayName } from "@t3tools/shared/inlineSkills";
import {
  serializeAssistantCitation,
  withAssistantCitationComment,
} from "@t3tools/shared/assistantCitations";
import { isProviderSkillUserInvocable } from "@t3tools/client-runtime/providerSkills";
import { use, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useAtomValue } from "@effect/atom-react";
import { collectComposerPromptInlineTokens } from "~/composer-editor-mentions";
import { useStableCallback } from "~/hooks/useStableCallback";
import { ComposerFileMentionChip } from "../ComposerFileMentionChip";
import type {
  ComposerCitationCommentRequest,
  ComposerPromptEditorProps,
} from "../ComposerPromptEditorTiptap";
import {
  ComposerContextActionsContext,
  ComposerContextReferenceChip,
} from "../composerContextPresentation";
import { AssistantCitationChip } from "../chat/AssistantCitationChip";
import { resolveAssistantCitationCommentDismissal } from "../chat/assistantCitationCommentDismissal";
import { ModelMentionChip, modelMentionKey, modelMentionKeysAtom } from "../chat/ModelMentionChip";
import { SkillChipPopover, skillPopoverDescription } from "../chat/SkillInlineText";

type Token = ReturnType<typeof collectComposerPromptInlineTokens>[number];
type Portal = { host: HTMLElement; token: Token; id: number };
type OpenCitation = { at: number; source: string; request?: ComposerCitationCommentRequest };

export function inComposerNode(state: EditorState, pos: number, names: readonly string[]) {
  for (let node = syntaxTree(state).resolveInner(pos, -1); node;) {
    if (names.includes(node.name)) return true;
    if (!node.parent) break;
    node = node.parent;
  }
  return false;
}

export const composerCodeNodes = ["FencedCode", "InlineCode", "CodeBlock"];

class ChipWidget extends WidgetType {
  constructor(
    readonly token: Token,
    readonly mount: (token: Token) => HTMLElement,
    readonly unmount: (host: HTMLElement) => void,
  ) {
    super();
  }
  override eq(other: ChipWidget) {
    return other.token.source === this.token.source && other.token.type === this.token.type;
  }
  toDOM() {
    return this.mount(this.token);
  }
  override destroy(host: HTMLElement) {
    this.unmount(host);
  }
}

const refresh = StateEffect.define<(token: Token) => boolean>();
function skillFor(skills: ReadonlyArray<ServerProviderSkill>, name: string) {
  return skills.find((s) => s.name === name && isProviderSkillUserInvocable(s));
}

export function useComposerVimChips(
  props: ComposerPromptEditorProps,
  viewRef: RefObject<EditorView | null>,
) {
  const actions = use(ComposerContextActionsContext);
  const modelKeys = useAtomValue(modelMentionKeysAtom(actions.environmentId ?? ""));
  const accepts = (t: Token) => {
    if (t.type === "skill") return !!skillFor(props.skills, t.value);
    if (t.type === "model") return modelKeys.has(modelMentionKey(t.instanceId, t.model));
    return true;
  };
  const known = useStableCallback(accepts);
  const [portals, setPortals] = useState<Portal[]>([]);
  const [open, setOpen] = useState<OpenCitation | null>(null);
  const draft = useRef<string | null>(null);
  const [extension] = useState(() => {
    let nextId = 0;
    const mount = (token: Token) => {
      const host = document.createElement("span");
      host.className = "inline-flex max-w-full align-baseline";
      host.contentEditable = "false";
      const portal = { host, token, id: nextId++ };
      setPortals((current) => [...current, portal]);
      return host;
    };
    const unmount = (host: HTMLElement) =>
      setPortals((current) => current.filter((p) => p.host !== host));
    const build = (state: EditorState, accept = known) =>
      Decoration.set(
        collectComposerPromptInlineTokens(state.doc.toString())
          .filter(
            (token) => accept(token) && !inComposerNode(state, token.start + 1, composerCodeNodes),
          )
          .map((token) =>
            Decoration.replace({ widget: new ChipWidget(token, mount, unmount) }).range(
              token.start,
              token.end,
            ),
          ),
        true,
      );
    return StateField.define<DecorationSet>({
      create: build,
      update(value, tr) {
        const refreshed = tr.effects.find((effect) => effect.is(refresh));
        return tr.docChanged || refreshed ? build(tr.state, refreshed?.value) : value;
      },
      provide: (field) => [
        EditorView.decorations.from(field),
        EditorView.atomicRanges.of((view) => view.state.field(field)),
      ],
    });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- changing providers can resolve or invalidate skill and model chips in an open draft.
  useLayoutEffect(() => {
    viewRef.current?.dispatch({ effects: refresh.of(accepts) });
  }, [accepts, viewRef]);

  const requestCitationComment = (request: ComposerCitationCommentRequest) => {
    const token = collectComposerPromptInlineTokens(request.value).find(
      (t) => t.type === "citation" && t.start === request.citationStart,
    );
    if (token) {
      draft.current = null;
      setOpen({ at: token.start, source: token.source, request });
    }
  };
  const saveDraftBeforeReplace = useStableCallback((text: string, next: string) => {
    if (!open || open.request?.value === next) return;
    const token = collectComposerPromptInlineTokens(text).find(
      (t) => t.type === "citation" && t.start === open.at && t.source === open.source,
    );
    if (token?.type === "citation" && props.onCitationDraftSave) {
      const dismissal = resolveAssistantCitationCommentDismissal({
        reason: "none",
        draft: draft.current,
        savedComment: token.citation.comment,
      });
      if (dismissal.kind === "commit")
        props.onCitationDraftSave(
          text,
          text.slice(0, token.start) +
            serializeAssistantCitation(
              withAssistantCitationComment(token.citation, dismissal.comment),
            ) +
            text.slice(token.end),
        );
    }
    draft.current = null;
    setOpen(null);
  });
  const render = ({ host, token }: Portal) => {
    switch (token.type) {
      case "mention":
        return <ComposerFileMentionChip path={token.value} />;
      case "context-reference":
        return <ComposerContextReferenceChip {...token} />;
      case "model":
        return <ModelMentionChip {...token} environmentId={actions.environmentId} />;
      case "skill": {
        const skill = skillFor(props.skills, token.value);
        return (
          <SkillChipPopover
            label={skill ? formatProviderSkillDisplayName(skill) : token.value}
            description={skill ? skillPopoverDescription(skill) : null}
            onViewInstructions={
              skill?.path && actions.environmentId
                ? () => actions.openMention(skill.path!)
                : undefined
            }
          />
        );
      }
      case "citation": {
        const view = EditorView.findFromDOM(host);
        if (!view) return null;
        const position = () => view.posAtDOM(host);
        const at = position();
        const target = open?.at === at && open.source === token.source ? open : null;
        const save = (comment: string) => {
          if (view.state.readOnly || !view.contentDOM.contains(host)) return false;
          const from = position();
          const source = serializeAssistantCitation(
            withAssistantCitationComment(token.citation, comment),
          );
          view.dispatch({
            ...(source === token.source
              ? {}
              : { changes: { from, to: from + token.source.length, insert: source } }),
            selection: { anchor: from + source.length },
          });
          return true;
        };
        return (
          <AssistantCitationChip
            citation={token.citation}
            commentEditor={{
              open: !!target,
              sourceAnchor: target?.request?.sourceAnchor,
              onOpenChange: (shown) => {
                draft.current = null;
                setOpen(
                  shown && !view.state.readOnly ? { at: position(), source: token.source } : null,
                );
              },
              onSave: save,
              onSaveAndSend: (comment) => {
                if (!save(comment)) return false;
                props.onCitationSubmitAndSend?.();
                return true;
              },
              onDraftChange: (text) => {
                draft.current = text;
              },
              ...(target?.request
                ? {
                    onCancel: () => {
                      const spaces = target.request!.insertedSpaces;
                      const from = position(),
                        to = from + token.source.length;
                      view.dispatch({
                        changes: {
                          from:
                            spaces.before && from && view.state.sliceDoc(from - 1, from) === " "
                              ? from - 1
                              : from,
                          to: spaces.after && view.state.sliceDoc(to, to + 1) === " " ? to + 1 : to,
                        },
                      });
                    },
                  }
                : {}),
              onRestoreFocus: () => {
                if (view.state.readOnly || !view.dom.isConnected) return;
                const current = collectComposerPromptInlineTokens(view.state.doc.toString()).find(
                  (t) => t.type === "citation" && t.start === at,
                );
                if (current)
                  view.dispatch({
                    selection: { anchor: current.end },
                    annotations: Transaction.remote.of(true),
                  });
                view.focus();
              },
            }}
          />
        );
      }
    }
  };
  return {
    extension,
    requestCitationComment,
    saveDraftBeforeReplace,
    portals: portals.map((p) => createPortal(render(p), p.host, p.id)),
  };
}
