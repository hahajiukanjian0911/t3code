import type {
  ProviderInstanceId,
  ServerProvider,
  EnvironmentId,
  UsageLimitSourceSnapshots,
} from "@t3tools/contracts";
import {
  collectLimitAccounts,
  collectLimitPools,
  displayLimitWindows,
  limitsNotice,
} from "@t3tools/shared/usageLimits";
import { useNavigate } from "@tanstack/react-router";
import { Fragment, useState, type ReactNode } from "react";
import { ChartNoAxesColumnIcon, ChevronRightIcon } from "lucide-react";

import { ClaudeAI, OpenAI } from "../Icons";
import geminiLogo from "../mcp/logos/gemini.png";
import { preferredUsageLimit } from "../usage/UsageLimitTrajectory.logic";
import { UsageLimitTrajectoryHost } from "../usage/UsageLimitTrajectoryPanel";
import { PROVIDER_PRESENTATION } from "../usage/usageProviders";
import { useNowMinute } from "../../hooks/useNowMinute";
import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import { formatContextWindowTokens } from "../../lib/contextWindow";
import { cn } from "../../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { readUsagePagePreferences, saveUsagePagePreferences } from "../usage/usagePagePreferences";
import { formatContextWindowCompactionMessage } from "./compaction.logic";
import { ThreadDetailsSection } from "./ThreadDetailsSection";

export interface ThreadDetailsUsageInput {
  readonly providerInstanceId: ProviderInstanceId | null;
  readonly model: string | null;
  readonly environmentId: EnvironmentId;
  readonly providers: readonly ServerProvider[];
  readonly sources: UsageLimitSourceSnapshots;
  readonly contextWindow: ContextWindowSnapshot | null;
}

type UsageTone = "error" | "warning" | null;

export function ThreadDetailsUsage({
  environmentId,
  providerInstanceId,
  model,
  providers,
  sources,
}: Omit<ThreadDetailsUsageInput, "contextWindow">) {
  const nowMinute = useNowMinute();
  const now = Date.parse(`${nowMinute}:00Z`);
  const navigate = useNavigate();
  const accounts = collectLimitAccounts(
    new Map([
      [
        environmentId,
        {
          entry: { target: { label: environmentId } },
          serverConfig: { providers, usageLimitSources: sources },
        },
      ],
    ]),
  );
  const pools = collectLimitPools(accounts, now);
  const provider = providers.find((p) => p.instanceId === providerInstanceId);
  const preferred = preferredUsageLimit(pools, provider?.driver ?? null, model);
  const [override, setOverride] = useState<string | null | undefined>();
  const expanded = override === undefined ? preferred : override;
  const notice = provider?.usageLimits && limitsNotice(provider.usageLimits);
  if (!notice && pools.length === 0) return null;
  return (
    <ThreadDetailsSection
      headingId="thread-details-usage-heading"
      title="Usage limits"
      showHeading={false}
    >
      <div>
        {pools.map((pool, index) => {
          const color =
            Object.values(PROVIDER_PRESENTATION).find((p) => p.driverKind === pool.driver)?.color ??
            "var(--foreground)";
          return displayLimitWindows(pool).map((window, windowIndex) => {
            const first = index === 0 && windowIndex === 0;
            const key = `${pool.driver}:${window.kind}:${window.id}`;
            const open = key === expanded;
            const shared = pool.driver === "antigravity" && window.id.startsWith("3p-");
            const label = shared
              ? window.label.replace(/^Claude & GPT \(shared\)/, "Others")
              : window.label;
            let logo: ReactNode = null;
            if (pool.driver === "codex") {
              logo = <OpenAI aria-hidden className="size-3.5" />;
            } else if (shared || pool.driver === "claudeAgent") {
              logo = <ClaudeAI aria-hidden className="size-3.5" />;
            } else if (pool.driver === "antigravity" && window.id.startsWith("gemini-")) {
              logo = (
                <img
                  src={geminiLogo}
                  alt=""
                  className="size-3.5 rounded-full object-cover object-center [object-view-box:inset(20%)]"
                />
              );
            }
            const rowLabel = logo ? label.replace(/^(?:Gemini|Others) · /, "") : label;
            return (
              <Fragment key={key}>
                <div className="relative">
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-label={
                      rowLabel === label ? undefined : `${label} ${window.remainingPercent}%`
                    }
                    onClick={() => setOverride(open ? null : key)}
                    className="grid w-full grid-cols-[minmax(0,1.95fr)_minmax(1.5rem,1fr)_4ch_auto] items-center gap-1.5 rounded-md px-2.5 py-1 text-left text-xs hover:bg-accent"
                  >
                    <span className={cn("flex min-w-0 items-center gap-1.5", first && "pl-5")}>
                      {!first && logo && <span className="shrink-0">{logo}</span>}
                      <span className="min-w-0 break-words">{rowLabel}</span>
                    </span>
                    <span
                      aria-hidden
                      className="h-[3px] overflow-hidden rounded-full bg-muted-foreground/20"
                    >
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${window.remainingPercent}%`, backgroundColor: color }}
                      />
                    </span>
                    <span className="text-right tabular-nums">{window.remainingPercent}%</span>
                    <ChevronRightIcon
                      className={cn("size-3 text-muted-foreground", open && "rotate-90")}
                    />
                  </button>
                  {first && (
                    <button
                      type="button"
                      aria-label="Usage limits"
                      className="absolute top-1/2 left-1.5 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent"
                      onClick={() => {
                        saveUsagePagePreferences({
                          ...readUsagePagePreferences(),
                          metric: "limits",
                        });
                        void navigate({ to: "/usage" });
                      }}
                    >
                      {logo ?? <ChartNoAxesColumnIcon className="size-3.5" />}
                    </button>
                  )}
                </div>
                {open && (
                  <UsageLimitTrajectoryHost
                    pool={label === window.label ? window : { ...window, label }}
                    color={color}
                    now={now}
                    compact
                    environmentId={environmentId}
                  />
                )}
              </Fragment>
            );
          });
        })}
        {notice && (
          <div className="grid grid-cols-[auto_1fr_auto] text-xs">
            <UsageRow label="Limits" fill={null} tone={null} value="Unavailable" tooltip={notice} />
          </div>
        )}
      </div>
    </ThreadDetailsSection>
  );
}

/** The thread's context window. The bar fills as context is used; the tick marks auto-compaction. */
export function ThreadDetailsContext({ usage }: { readonly usage: ContextWindowSnapshot }) {
  const maxTokens = usage.maxTokens != null && usage.maxTokens > 0 ? usage.maxTokens : null;
  const used =
    maxTokens !== null && usage.usedPercentage !== null
      ? Math.round(Math.max(0, Math.min(100, usage.usedPercentage)))
      : null;
  const threshold = usage.autoCompactThreshold ?? null;
  const tick =
    maxTokens !== null && threshold !== null && threshold > 0 && threshold < maxTokens
      ? (threshold / maxTokens) * 100
      : null;
  const usedTokens = formatContextWindowTokens(usage.usedTokens);
  return (
    <ThreadDetailsSection
      headingId="thread-details-context-heading"
      title="Context window"
      showHeading={false}
    >
      <div className="grid grid-cols-[auto_minmax(3rem,1fr)_auto] gap-x-3 text-xs">
        <UsageRow
          label="Context"
          fill={used}
          tone={used === null ? null : used >= 90 ? "error" : used >= 80 ? "warning" : null}
          tick={tick}
          muted
          value={
            maxTokens !== null
              ? `${usedTokens} / ${formatContextWindowTokens(maxTokens)}`
              : usedTokens
          }
          ariaValue={used !== null ? `${used}% used` : `${usedTokens} tokens used`}
          tooltip={
            <>
              <span className="text-foreground">
                {used !== null ? `Context: ${used}% used` : `Context: ${usedTokens} tokens used`}
              </span>
              {maxTokens !== null ? (
                <span className="text-muted-foreground">
                  {usage.usedTokens.toLocaleString("en-US")} of {maxTokens.toLocaleString("en-US")}{" "}
                  tokens
                </span>
              ) : null}
              {threshold !== null && threshold > 0 ? (
                <span className="text-muted-foreground">
                  {formatContextWindowCompactionMessage(threshold)}
                </span>
              ) : null}
            </>
          }
        />
      </div>
    </ThreadDetailsSection>
  );
}

/** One label, hairline, and value row; the whole row opens the details tooltip. */
function UsageRow({
  label,
  fill,
  tone,
  tick = null,
  value,
  ariaValue = value,
  tooltip,
  muted = false,
}: {
  readonly label: string;
  /** Bar fill from 0 to 100. Null hides the bar. */
  readonly fill: number | null;
  readonly tone: UsageTone;
  /** A marker on the bar, from 0 to 100. */
  readonly tick?: number | null;
  readonly value: string;
  readonly ariaValue?: string;
  readonly tooltip: ReactNode;
  readonly muted?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            tabIndex={0}
            aria-label={`${label}: ${ariaValue}`}
            className="col-span-3 grid h-6 cursor-default grid-cols-subgrid items-center rounded-lg px-2.5 outline-none hover:bg-black/[0.035] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-popup-open:bg-black/[0.035] dark:hover:bg-white/[0.08] dark:data-popup-open:bg-white/[0.08]"
          />
        }
      >
        <span className="max-w-28 truncate text-muted-foreground">{label}</span>
        {fill !== null ? (
          <span className="relative h-[3px] rounded-full bg-muted-foreground/30 dark:bg-muted-foreground/20">
            {fill > 0 ? (
              <span
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full",
                  tone === "error"
                    ? "bg-error"
                    : tone === "warning"
                      ? "bg-warning"
                      : muted
                        ? "bg-muted-foreground"
                        : "bg-foreground/80",
                )}
                style={{ width: `max(${fill}%, 6px)` }}
              />
            ) : null}
            {tick !== null ? (
              <span
                aria-hidden
                className="absolute -top-[3px] h-[9px] w-px -translate-x-1/2 bg-foreground/60"
                style={{ left: `${tick}%` }}
              />
            ) : null}
          </span>
        ) : null}
        <span
          className={cn(
            // Text-only rows span the bar column so they never widen the shared value column.
            "text-end font-medium tabular-nums",
            fill === null && "col-span-2",
            tone === "error"
              ? "text-error-foreground"
              : tone === "warning"
                ? "text-warning-foreground"
                : fill === null
                  ? "text-muted-foreground"
                  : "text-foreground/80",
          )}
        >
          {value}
        </span>
      </TooltipTrigger>
      {/* Rows sit 8px inside the card; clear its edge instead of overlapping it. */}
      <TooltipPopup side="left" sideOffset={16}>
        <div className="flex flex-col gap-0.5">{tooltip}</div>
      </TooltipPopup>
    </Tooltip>
  );
}
