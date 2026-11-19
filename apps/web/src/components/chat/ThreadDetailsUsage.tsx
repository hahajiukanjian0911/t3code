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
import { ChartNoAxesColumnIcon, ChevronRightIcon, GaugeIcon } from "lucide-react";

import geminiMark from "../../assets/gemini-mark.png";
import { ClaudeAI, OpenAI } from "../Icons";
import { preferredUsageLimit } from "../usage/UsageLimitTrajectory.logic";
import { UsageLimitTrajectoryHost } from "../usage/UsageLimitTrajectoryPanel";
import { PROVIDER_PRESENTATION } from "../usage/usageProviders";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useClientSettings } from "../../hooks/useSettings";
import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import { formatContextWindowTokens } from "../../lib/contextWindow";
import { cn } from "../../lib/utils";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { readUsagePagePreferences, saveUsagePagePreferences } from "../usage/usagePagePreferences";
import { ThreadDetailsSection } from "./ThreadDetailsSection";

export interface ThreadDetailsUsageInput {
  readonly providerInstanceId: ProviderInstanceId | null;
  readonly model: string | null;
  readonly environmentId: EnvironmentId;
  readonly providers: readonly ServerProvider[];
  readonly sources: UsageLimitSourceSnapshots;
  readonly contextWindow: ContextWindowSnapshot | null;
}

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
      <div className="grid grid-cols-[4.75rem_minmax(1.5rem,1fr)_4ch_auto] gap-x-1.5 text-xs">
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
              logo = <img src={geminiMark} alt="" className="size-3.5" />;
            }
            const rowLabel = logo ? label.replace(/^(?:Gemini|Others) · /, "") : label;
            return (
              <Fragment key={key}>
                <div className="relative col-span-full grid grid-cols-subgrid">
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-label={
                      rowLabel === label ? undefined : `${label} ${window.remainingPercent}%`
                    }
                    onClick={() => setOverride(open ? null : key)}
                    className="col-span-full grid grid-cols-subgrid items-center rounded-md px-2.5 py-1 text-left outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring focus-visible:bg-accent"
                  >
                    <span className={cn("flex min-w-0 items-center gap-1.5", first && "pl-5")}>
                      {!first && logo && <span className="shrink-0">{logo}</span>}
                      <span className="min-w-0 wrap-anywhere">{rowLabel}</span>
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
                  <div className="col-span-full">
                    <UsageLimitTrajectoryHost
                      pool={label === window.label ? window : { ...window, label }}
                      color={color}
                      now={now}
                      compact
                      environmentId={environmentId}
                    />
                  </div>
                )}
              </Fragment>
            );
          });
        })}
        {notice && (
          <Tooltip>
            <TooltipTrigger
              render={<div tabIndex={0} />}
              className="col-span-full flex h-6 items-center justify-between rounded-md px-2.5 text-muted-foreground outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring focus-visible:bg-accent"
            >
              <span>Limits</span>
              <span>Unavailable</span>
            </TooltipTrigger>
            <TooltipPopup side="left" sideOffset={16}>
              {notice}
            </TooltipPopup>
          </Tooltip>
        )}
      </div>
    </ThreadDetailsSection>
  );
}

/** The thread's context window. The bar fills as context is used; the tick marks auto-compaction. */
const CONTEXT_ROW_LABEL = "Context";

export function ThreadDetailsContext({ usage }: { readonly usage: ContextWindowSnapshot }) {
  const maxTokens = usage.maxTokens != null && usage.maxTokens > 0 ? usage.maxTokens : null;
  const used =
    maxTokens !== null && usage.usedPercentage !== null
      ? Math.round(Math.max(0, Math.min(100, usage.usedPercentage)))
      : null;
  const contextSizeLabel =
    maxTokens !== null
      ? `${formatContextWindowTokens(usage.usedTokens)} / ${formatContextWindowTokens(maxTokens)}`
      : formatContextWindowTokens(usage.usedTokens);
  const threshold = usage.autoCompactThreshold ?? null;
  const tick =
    maxTokens !== null && threshold !== null && threshold > 0 && threshold < maxTokens
      ? (threshold / maxTokens) * 100
      : null;
  const locale = useClientSettings((settings) => settings.uiLocale);
  return (
    <ThreadDetailsSection
      headingId="thread-details-context-heading"
      title="Context window"
      showHeading={false}
    >
      <Collapsible>
        <CollapsibleTrigger className="group flex w-full items-center gap-1.5 rounded-md px-2.5 py-1 text-left text-xs outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring focus-visible:bg-accent">
          <span className="flex w-[4.75rem] shrink-0 items-center gap-1.5">
            <GaugeIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">{CONTEXT_ROW_LABEL}</span>
          </span>
          {used !== null ? (
            <span
              aria-hidden
              className="relative h-[3px] min-w-0 flex-1 rounded-full bg-muted-foreground/20"
            >
              <span
                className={cn(
                  "block h-full rounded-full",
                  used >= 90 ? "bg-error" : used >= 80 ? "bg-warning" : "bg-muted-foreground",
                )}
                style={{ width: `${used}%` }}
              />
              {tick !== null && (
                <span
                  className="absolute -top-[3px] h-[9px] w-px -translate-x-1/2 bg-foreground/60"
                  style={{ left: `${tick}%` }}
                />
              )}
            </span>
          ) : null}
          <span
            className={cn(
              "ml-auto shrink-0 whitespace-nowrap text-end tabular-nums",
              used !== null && used >= 90
                ? "text-error-foreground"
                : used !== null && used >= 80
                  ? "text-warning-foreground"
                  : "text-foreground/80",
            )}
          >
            {contextSizeLabel}
          </span>
          <ChevronRightIcon
            aria-hidden
            className="size-3 shrink-0 text-muted-foreground group-aria-expanded:rotate-90"
          />
        </CollapsibleTrigger>
        <CollapsiblePanel animate={false} data-thread-details-context-overflow>
          <div className="space-y-2 px-2.5 pt-1 pb-1 text-xs">
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1 text-muted-foreground">
              <dt>Used tokens</dt>
              <dd className="text-end text-foreground tabular-nums">
                {usage.usedTokens.toLocaleString(locale)}
              </dd>
              {maxTokens !== null && (
                <>
                  {usage.remainingTokens !== null && (
                    <>
                      <dt>Remaining tokens</dt>
                      <dd className="text-end text-foreground tabular-nums">
                        {usage.remainingTokens.toLocaleString(locale)}
                      </dd>
                    </>
                  )}
                  <dt>Window limit</dt>
                  <dd className="text-end text-foreground tabular-nums">
                    {maxTokens.toLocaleString(locale)}
                  </dd>
                </>
              )}
            </dl>
            {maxTokens === null && (
              <p className="text-muted-foreground">The provider has not reported a window limit.</p>
            )}
            {threshold !== null && threshold > 0 && (
              <p className="text-muted-foreground">
                Auto-compaction starts around {threshold.toLocaleString(locale)} tokens.
              </p>
            )}
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </ThreadDetailsSection>
  );
}
