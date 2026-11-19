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
  className,
}: {
  telemetry: VimTelemetrySnapshot | null;
  className?: string;
}) {
  if (!telemetry) return null;
  const isVisual =
    telemetry.mode === "visual" ||
    telemetry.mode === "visual-line" ||
    telemetry.mode === "visual-block";
  const isInsert = telemetry.mode === "insert" || telemetry.mode === "replace";

  return (
    <div
      data-composer-vim-status=""
      className={cn(
        "inline-flex shrink-0 select-none items-center gap-1.5 font-mono text-2xs leading-none tabular-nums",
        className,
      )}
    >
      <span
        data-vim-mode={telemetry.mode}
        className={cn(
          "inline-flex items-center rounded px-1.5 py-0.75 text-3xs font-semibold tracking-wider uppercase",
          isInsert
            ? "bg-primary/15 text-primary"
            : isVisual
              ? "bg-warning/18 text-warning-foreground"
              : "bg-muted text-muted-foreground",
        )}
      >
        {MODE_LABELS[telemetry.mode]}
      </span>
      <span className="text-muted-foreground/75">
        {telemetry.line}:{telemetry.column}
      </span>
      {telemetry.pendingKeys ? (
        <span className="font-semibold text-foreground">{telemetry.pendingKeys}</span>
      ) : null}
    </div>
  );
}
