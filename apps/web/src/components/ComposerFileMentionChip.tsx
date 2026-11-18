import { useNativeFileDrag } from "../useNativeFileDrag";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import { basenameOfPath, documentChipKindForFileName } from "~/pierre-icons";
import { WorkspaceEntryTooltip } from "./chat/WorkspaceEntryIcon";
import { FileTagChipContent } from "./chat/FileTagChip";
import { ContextChip } from "./ContextChip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { use } from "react";
import { ComposerContextActionsContext } from "./composerContextPresentation";

export function ComposerFileMentionChip({ path }: { path: string }) {
  const actions = use(ComposerContextActionsContext);
  const nativeDrag = useNativeFileDrag(actions.environmentId, () =>
    resolvePathLinkTarget(path, actions.cwd ?? ""),
  );
  const chip = (
    <ContextChip
      {...nativeDrag}
      kind={documentChipKindForFileName(path) ?? "mention"}
      dir="ltr"
      render={<button type="button" />}
      onClick={() => actions.openMention(path)}
      aria-label={`Preview ${path}`}
      contentEditable={false}
      spellCheck={false}
      data-composer-mention-chip="true"
    >
      <FileTagChipContent
        path={path}
        environmentId={actions.environmentId}
        cwd={actions.cwd}
        label={basenameOfPath(path)}
        theme={document.documentElement.classList.contains("dark") ? "dark" : "light"}
      />
    </ContextChip>
  );
  return (
    <Tooltip>
      <TooltipTrigger render={chip} />
      <TooltipPopup side="top">
        <WorkspaceEntryTooltip
          path={path}
          environmentId={actions.environmentId}
          cwd={actions.cwd}
        />
      </TooltipPopup>
    </Tooltip>
  );
}
