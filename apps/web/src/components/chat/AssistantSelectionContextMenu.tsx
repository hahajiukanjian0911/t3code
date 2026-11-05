import {
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  MessageId,
  type AssistantCitation,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useEffect, useEffectEvent } from "react";

import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import {
  captureAssistantTextSelection,
  type AssistantCitationSourceAnchor,
} from "~/lib/assistantTextSelection";
import { readLocalApi } from "~/localApi";
import { chatMarkdownClipboardPayload } from "~/markdown-clipboard";
import { toastManager } from "../ui/toast";
import { reportMarkdownActionFailure } from "./markdownActionFailure";

export function AssistantSelectionContextMenu({
  viewport,
  threadRef,
  onCite,
}: {
  viewport: HTMLElement | null;
  threadRef: ScopedThreadRef;
  onCite: (citation: AssistantCitation, sourceAnchor: AssistantCitationSourceAnchor) => boolean;
}) {
  const cite = useEffectEvent(onCite);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes the viewport to explicit selection context-menu requests
  useEffect(() => {
    if (!viewport) return;
    let active = true;
    const showMenu = async (event: MouseEvent) => {
      const target = event.target;
      if (
        event.defaultPrevented ||
        !(target instanceof Element) ||
        target.closest(
          "a, button, input, textarea, select, [role=button], [contenteditable], img, video, audio",
        )
      ) {
        return;
      }
      const nativeSelection = window.getSelection();
      const captured = captureAssistantTextSelection(viewport, nativeSelection);
      const messageId = captured?.source.dataset.assistantCitationSource;
      const api = readLocalApi();
      if (!captured || !messageId || !captured.source.contains(target) || !api) return;

      event.preventDefault();
      event.stopPropagation();
      const citation: AssistantCitation = {
        version: 1,
        ...threadRef,
        messageId: MessageId.make(messageId),
        ...captured.selector,
      };
      const sourceAnchor = { source: captured.source, range: captured.range, viewport };
      const clipboard = chatMarkdownClipboardPayload(nativeSelection!);
      const tooLong = citation.text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH;
      const rect = captured.range.getBoundingClientRect();
      const position =
        event.clientX === 0 && event.clientY === 0
          ? { x: rect.left, y: rect.bottom }
          : { x: event.clientX, y: event.clientY };
      try {
        const action = await api.contextMenu.show(
          [
            { id: "copy", label: "Copy" },
            {
              id: "cite",
              label: tooLong ? "Selection is too long to cite" : "Cite",
              disabled: tooLong,
            },
          ] as const,
          position,
        );
        if (!active || !captured.source.isConnected) return;
        if (action === "cite" && !tooLong && cite(citation, sourceAnchor)) {
          nativeSelection?.removeAllRanges();
        } else if (action === "copy") {
          await writeTextToClipboard(
            clipboard?.text ?? citation.text,
            "selection",
            clipboard ? { "text/html": clipboard.html } : undefined,
          );
        }
      } catch (cause) {
        reportMarkdownActionFailure({ operation: "selection-context-menu" }, cause);
        toastManager.add({
          type: "error",
          title: "Unable to complete selection action",
          description: cause instanceof Error ? cause.message : "The request failed.",
        });
      }
    };
    const onContextMenu = (event: MouseEvent) => void showMenu(event);
    viewport.addEventListener("contextmenu", onContextMenu);
    return () => {
      active = false;
      viewport.removeEventListener("contextmenu", onContextMenu);
    };
  }, [threadRef, viewport]);

  return null;
}
