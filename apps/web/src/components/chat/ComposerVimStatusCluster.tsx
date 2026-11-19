import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import type { VimTelemetrySnapshot } from "../editor/vimKeymapsAndIme";

const MODE_LABELS: Readonly<Record<VimTelemetrySnapshot["mode"], string>> = {
  normal: "NORMAL",
  insert: "INSERT",
  visual: "VISUAL",
  "visual-line": "V-LINE",
  "visual-block": "V-BLOCK",
  replace: "REPLACE",
};

export function ComposerVimStatusCluster({
  telemetry,
  onStopMacroRecording,
  className,
}: {
  telemetry: VimTelemetrySnapshot | null;
  onStopMacroRecording?: () => void;
  className?: string;
}) {
  if (!telemetry) return null;
  const isVisual =
    telemetry.mode === "visual" ||
    telemetry.mode === "visual-line" ||
    telemetry.mode === "visual-block";
  const isInsert = telemetry.mode === "insert";
  const isReplace = telemetry.mode === "replace";

  return (
    <div
      data-composer-vim-status=""
      className={cn(
        "inline-flex min-w-0 shrink-0 select-none items-center gap-1.5 font-mono text-2xs leading-none tabular-nums",
        className,
      )}
    >
      <span
        data-vim-mode={telemetry.mode}
        className={cn(
          "inline-flex items-center rounded-md px-1.5 py-1 text-3xs font-medium tracking-wider uppercase ring-1 ring-inset",
          isInsert
            ? "bg-primary/10 text-primary ring-primary/20"
            : isReplace
              ? "bg-destructive/10 text-destructive ring-destructive/20"
              : isVisual
                ? "bg-warning/14 text-warning-foreground ring-warning/25"
                : "bg-muted/65 text-muted-foreground ring-border/65",
        )}
      >
        {MODE_LABELS[telemetry.mode]}
      </span>
      <span className="text-2xs text-muted-foreground/65">
        {telemetry.line}:{telemetry.column}
      </span>
      {telemetry.pendingKeys ? (
        <span className="rounded bg-foreground/8 px-1 py-0.5 text-3xs font-medium text-foreground">
          {telemetry.pendingKeys}
        </span>
      ) : null}
      {telemetry.recordingRegister ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                data-vim-recording={telemetry.recordingRegister}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onStopMacroRecording?.()}
                aria-label={`Stop recording macro @${telemetry.recordingRegister}`}
                className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-1 text-3xs font-medium text-destructive ring-1 ring-inset ring-destructive/25 transition-colors hover:bg-destructive/16"
              >
                <span className="size-1.5 rounded-full bg-destructive" aria-hidden="true" />
                <span>REC @{telemetry.recordingRegister}</span>
              </button>
            }
          />
          <TooltipPopup side="top">
            Recording macro @{telemetry.recordingRegister}. Click or press q to stop.
          </TooltipPopup>
        </Tooltip>
      ) : null}
      {!telemetry.recordingRegister && telemetry.notice ? (
        <span data-vim-notice="" className="max-w-40 truncate text-2xs text-muted-foreground/80">
          {telemetry.notice}
        </span>
      ) : null}
    </div>
  );
}
