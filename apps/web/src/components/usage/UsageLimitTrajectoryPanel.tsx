import type { EnvironmentId, UsageLimitHistorySample } from "@t3tools/contracts";
import { formatDuration, type LimitPoolWindow } from "@t3tools/shared/usageLimits";
import { useId, useState } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import {
  buildUsageLimitTrajectory,
  usageLimitCycleEnd,
  usageLimitDurationMs,
  type BurnRateMode,
  type TrajectoryPoint,
} from "./UsageLimitTrajectory.logic";

import { useUsageLimitHistorySamples } from "../../state/usage";
const PAD_LEFT = 36;
const PAD_RIGHT = 14;
const PAD_TOP = 20;
const PAD_BOTTOM = 26;

const BURN_MODES: readonly { readonly value: BurnRateMode; readonly label: string }[] = [
  { value: "1h", label: "1h" },
  { value: "3h", label: "3h" },
  { value: "6h", label: "6h" },
  { value: "even", label: "Even" },
];

function formatAxisTick(atMs: number, spanMs: number): string {
  const date = new Date(atMs);
  if (spanMs <= 36 * 3600_000) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
}

function buildSvgPolyline(
  points: readonly TrajectoryPoint[],
  xOf: (ms: number) => number,
  yOf: (pct: number) => number,
): string {
  if (points.length === 0) return "";
  return points
    .map(
      (pt, index) =>
        `${index === 0 ? "M" : "L"}${xOf(pt.atMs).toFixed(1)},${yOf(pt.remainingPercent).toFixed(1)}`,
    )
    .join(" ");
}

interface PanelProps {
  readonly pool: LimitPoolWindow;
  readonly color: string;
  readonly now: number;
  readonly compact?: boolean;
  readonly environmentId?: EnvironmentId;
}

export function UsageLimitTrajectoryHost(props: PanelProps) {
  if (usageLimitCycleEnd(props.pool, props.now) === null) {
    return (
      <p className="px-2 py-1 text-xs text-muted-foreground md:col-span-2">
        Reset time unavailable
      </p>
    );
  }
  return <UsageLimitHistoryChart {...props} />;
}

function UsageLimitHistoryChart(props: PanelProps) {
  const lastReport = Math.max(
    ...props.pool.members.map(({ account }) => Date.parse(account.limits.checkedAt)),
  );
  const since = Math.max(
    0,
    Math.floor((lastReport - usageLimitDurationMs(props.pool)) / 600_000) * 600_000,
  );
  const samples = useUsageLimitHistorySamples(since, props.environmentId);
  return <UsageLimitTrajectoryPanel {...props} samples={samples} />;
}

function UsageLimitTrajectoryPanel({
  pool,
  color,
  now,
  samples,
  compact = false,
}: PanelProps & { readonly samples: readonly UsageLimitHistorySample[] }) {
  const viewWidth = compact ? 270 : 760;
  const viewHeight = compact ? 108 : 186;
  const plotWidth = viewWidth - PAD_LEFT - PAD_RIGHT;
  const plotHeight = viewHeight - PAD_TOP - PAD_BOTTOM;
  const gradientId = useId();
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const [mode, setMode] = useState<BurnRateMode>("3h");

  const trajectory = buildUsageLimitTrajectory({
    pool,
    samples,
    nowMs: now,
    mode,
  });

  const totalSpanMs = Math.max(1, trajectory.endMs - trajectory.startMs);
  const xOf = (ms: number) =>
    PAD_LEFT + Math.max(0, Math.min(1, (ms - trajectory.startMs) / totalSpanMs)) * plotWidth;
  const yOf = (pct: number) => PAD_TOP + (1 - Math.max(0, Math.min(100, pct)) / 100) * plotHeight;

  const nowX = xOf(trajectory.nowMs);
  const nowY = yOf(trajectory.currentRemainingPercent);
  const bottomY = PAD_TOP + plotHeight;

  const recordedPath = buildSvgPolyline(trajectory.recorded, xOf, yOf);
  const recordedArea =
    trajectory.recorded.length >= 2
      ? `${recordedPath} L${xOf(trajectory.recorded[trajectory.recorded.length - 1]!.atMs).toFixed(1)},${bottomY.toFixed(1)} L${xOf(trajectory.recorded[0]!.atMs).toFixed(1)},${bottomY.toFixed(1)} Z`
      : "";
  // The refill at the right edge belongs to the next cycle.
  const cycleProjection = trajectory.projected.filter(
    (point, index, points) =>
      point.atMs < trajectory.endMs || points[index - 1]?.atMs !== trajectory.endMs,
  );
  const projectedPath = buildSvgPolyline(cycleProjection, xOf, yOf);

  const axisTicks = (compact ? [0, 1] : [0, 0.25, 0.5, 0.75, 1]).map(
    (ratio) => trajectory.startMs + Math.round(totalSpanMs * ratio),
  );

  const emptyIso =
    trajectory.emptyAtMs !== null ? new Date(trajectory.emptyAtMs).toISOString() : null;
  const firstMemberEmptyIso =
    trajectory.firstMemberEmpty !== null
      ? new Date(trajectory.firstMemberEmpty.emptyAtMs).toISOString()
      : null;
  const nextResetIso =
    trajectory.nextReset !== null ? new Date(trajectory.nextReset.atMs).toISOString() : null;

  return (
    <div
      data-usage-limit-trajectory=""
      className={
        compact
          ? "mx-2 mb-1 flex flex-col gap-1"
          : "mt-1 flex flex-col gap-3 border-t border-border/60 pt-3.5 md:col-span-2"
      }
      onClick={(event) => event.stopPropagation()}
    >
      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-2xs text-muted-foreground">Pool empty</span>
              <span
                className={cn(
                  "font-medium tabular-nums",
                  trajectory.emptyAtMs !== null ? "text-destructive" : "text-foreground",
                )}
              >
                {emptyIso
                  ? formatUpcomingTimestamp(emptyIso, timestampFormat, now)
                  : "Safe through cycle"}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-2xs text-muted-foreground">First empty</span>
              <span className="truncate font-medium text-foreground tabular-nums">
                {trajectory.firstMemberEmpty && firstMemberEmptyIso
                  ? `${trajectory.firstMemberEmpty.accountLabel} · in ${formatDuration(trajectory.firstMemberEmpty.emptyAtMs - now)}`
                  : "None projected"}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-2xs text-muted-foreground">Next reset</span>
              <span className="font-medium text-foreground tabular-nums">
                {trajectory.nextReset && nextResetIso
                  ? `+${trajectory.nextReset.restoresPercent}% · ${formatUpcomingTimestamp(nextResetIso, timestampFormat, now)}`
                  : "Unavailable"}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-2xs text-muted-foreground">Burn rate</span>
              <span className="font-medium text-foreground tabular-nums">
                {trajectory.burnPercentPerHour}%/h
              </span>
            </div>
          </div>

          <div
            role="group"
            aria-label="Burn rate window"
            className="inline-flex items-center gap-0.5 rounded-lg border border-border/60 bg-muted/40 p-0.5 text-2xs"
          >
            {BURN_MODES.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={mode === option.value}
                onClick={() => setMode(option.value)}
                className={cn(
                  "cursor-pointer rounded-md px-2 py-0.5 font-medium transition-colors",
                  mode === option.value
                    ? "bg-background text-foreground shadow-2xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* SVG Recorded + Projected Trajectory Chart */}
      <div className="relative overflow-hidden rounded-lg border border-border/50 bg-muted/20 px-2 pt-2 pb-1">
        <svg
          viewBox={`0 0 ${viewWidth} ${viewHeight}`}
          className={cn("w-full overflow-visible select-none", compact ? "h-auto" : "h-44")}
          role="img"
          aria-label={`${pool.label} quota trajectory chart`}
        >
          <defs>
            <linearGradient id={`${gradientId}-rec`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Horizontal Y gridlines (100%, 50%, 0%) */}
          {[100, 50, 0].map((pct) => {
            const y = yOf(pct);
            return (
              <g key={pct}>
                <line
                  x1={PAD_LEFT}
                  y1={y}
                  x2={viewWidth - PAD_RIGHT}
                  y2={y}
                  stroke="currentColor"
                  className="text-border/60"
                  strokeWidth="1"
                  strokeDasharray={pct === 50 ? "3 3" : undefined}
                />
                <text
                  x={PAD_LEFT - 6}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-muted-foreground text-3xs tabular-nums"
                >
                  {pct}%
                </text>
              </g>
            );
          })}

          {/* X time ticks */}
          {axisTicks.map((tickMs, idx) => {
            const x = xOf(tickMs);
            return (
              <text
                key={tickMs}
                x={x}
                y={viewHeight - 6}
                textAnchor={idx === 0 ? "start" : idx === axisTicks.length - 1 ? "end" : "middle"}
                className="fill-muted-foreground text-3xs tabular-nums"
              >
                {formatAxisTick(tickMs, totalSpanMs)}
              </text>
            );
          })}

          {/* Recorded historical shaded area + solid line */}
          {recordedArea ? <path d={recordedArea} fill={`url(#${gradientId}-rec)`} /> : null}
          {recordedPath ? (
            <path
              d={recordedPath}
              fill="none"
              stroke={color}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null}

          {/* Projected future dashed slope + vertical reset step-ups */}
          {projectedPath ? (
            <path
              d={projectedPath}
              fill="none"
              stroke={color}
              strokeWidth="1.75"
              strokeDasharray="4 3.5"
              strokeLinejoin="round"
              opacity="0.88"
            />
          ) : null}

          {/* Vertical Now divider & live anchor dot */}
          <line
            x1={nowX}
            y1={PAD_TOP - 4}
            x2={nowX}
            y2={bottomY}
            stroke="currentColor"
            className="text-foreground/35"
            strokeWidth="1"
          />
          <text
            x={nowX}
            y={PAD_TOP - 7}
            textAnchor="middle"
            className="fill-foreground/80 text-3xs font-semibold"
          >
            Now
          </text>
          <circle
            cx={nowX}
            cy={nowY}
            r="3.5"
            fill={color}
            stroke="var(--background)"
            strokeWidth="1.5"
          />

          {/* Step-up refill annotations (+XX%) */}
          {trajectory.refills
            .filter((refill) => refill.atMs < trajectory.endMs)
            .slice(0, 5)
            .map((refill) => {
              const rx = xOf(refill.atMs);
              const ry = yOf(refill.toPercent);
              return (
                <g key={`${refill.atMs}-${refill.accountLabel}`}>
                  <circle cx={rx} cy={ry} r="2.5" fill={color} />
                  <text
                    x={Math.min(viewWidth - PAD_RIGHT - 16, Math.max(PAD_LEFT + 16, rx))}
                    y={Math.max(PAD_TOP + 9, ry - 6)}
                    textAnchor="middle"
                    className="fill-foreground/85 text-3xs font-medium tabular-nums"
                  >
                    +{refill.restoresPercent}%
                  </text>
                </g>
              );
            })}

          {/* Empty touch-down marker */}
          {trajectory.emptyAtMs !== null && trajectory.emptyAtMs > now ? (
            <g>
              <circle
                cx={xOf(trajectory.emptyAtMs)}
                cy={yOf(0)}
                r="4"
                className="fill-background stroke-destructive"
                strokeWidth="2"
              />
              <text
                x={Math.min(
                  viewWidth - PAD_RIGHT - 32,
                  Math.max(PAD_LEFT + 32, xOf(trajectory.emptyAtMs)),
                )}
                y={yOf(0) - 7}
                textAnchor="middle"
                className="fill-destructive text-3xs font-semibold tabular-nums"
              >
                Empty
              </text>
            </g>
          ) : null}
        </svg>

        <div className="flex items-center justify-between px-2 pb-0.5 text-2xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block h-0.5 w-3.5 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span>Recorded</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block h-0 w-3.5 border-t-2 border-dashed"
                style={{ borderColor: color }}
              />
              <span>Projected</span>
            </span>
          </div>
          <span>
            {pool.members.length} {pool.members.length === 1 ? "account" : "accounts"}
          </span>
        </div>
      </div>
    </div>
  );
}
