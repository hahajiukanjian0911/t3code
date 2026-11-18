import type { UsageLimitHistorySample } from "@t3tools/contracts";
import {
  displayLimitWindows,
  limitPoolWeights,
  type LimitPool,
  type LimitPoolWindow,
} from "@t3tools/shared/usageLimits";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export type BurnRateMode = "1h" | "3h" | "6h" | "even";

export interface TrajectoryPoint {
  readonly atMs: number;
  readonly remainingPercent: number;
}

export interface TrajectoryRefillEvent {
  readonly atMs: number;
  readonly restoresPercent: number;
  readonly fromPercent: number;
  readonly toPercent: number;
  readonly accountLabel: string;
}

export interface UsageLimitTrajectory {
  readonly startMs: number;
  readonly nowMs: number;
  readonly endMs: number;
  readonly currentRemainingPercent: number;
  readonly burnPercentPerHour: number;
  readonly burnSource: "observed" | "elapsed" | "even";
  readonly recorded: readonly TrajectoryPoint[];
  readonly projected: readonly TrajectoryPoint[];
  readonly refills: readonly TrajectoryRefillEvent[];
  readonly emptyAtMs: number | null;
  readonly firstMemberEmpty: {
    readonly accountLabel: string;
    readonly emptyAtMs: number;
  } | null;
  readonly nextReset: {
    readonly atMs: number;
    readonly restoresPercent: number;
  } | null;
}

export function usageLimitDurationMs(pool: LimitPoolWindow): number {
  const reported = pool.members.find((m) => (m.window.windowDurationMins ?? 0) > 0)?.window
    .windowDurationMins;
  if (reported && reported > 0) return reported * MINUTE_MS;
  switch (pool.kind) {
    case "session":
      return 5 * HOUR_MS;
    case "weekly":
      return 7 * DAY_MS;
    case "monthly":
      return 30 * DAY_MS;
    case "other":
      return 24 * HOUR_MS;
  }
}

export function usageLimitCycleEnd(pool: LimitPoolWindow, now: number) {
  if (pool.kind === "other" && !pool.members.some((m) => m.window.windowDurationMins)) return null;
  const latest = now + usageLimitDurationMs(pool);
  return pool.resets.find((reset) => reset.at > now && reset.at <= latest + MINUTE_MS)?.at ?? null;
}

export function preferredUsageLimit(
  pools: readonly LimitPool[],
  driver: string | null,
  model: string | null,
) {
  const group = pools.find((pool) => pool.driver === driver);
  if (!group || !model) return null;
  let windows = displayLimitWindows(group).filter((window) =>
    window.members.some(
      ({ window: member }) =>
        (!member.modelIds || member.modelIds.includes(model)) &&
        (!member.providerIds || member.providerIds.includes(model.split("/")[0]!)),
    ),
  );
  if (driver === "antigravity") {
    const family = model.split("-")[0];
    const variant = model.match(/(?:^|-)(argon|carbon)(?:-|$)/)?.[1];
    const specific = variant ? windows.filter((w) => w.id.startsWith(`gemini-${variant}-`)) : [];
    windows = specific.length
      ? specific
      : windows.filter(
          (w) =>
            (family === "gemini" && /^gemini-(?!argon-|carbon-)/.test(w.id)) ||
            ((family === "claude" || family === "gpt") &&
              (w.id.startsWith("3p-") || w.id.startsWith(family + "-"))),
        );
  }
  const window =
    windows.find((w) => w.members.some((m) => m.window.windowDurationMins === 300)) ??
    windows.find((w) => w.kind === "session") ??
    windows.find((w) => w.kind === "weekly") ??
    windows[0];
  return window ? `${driver}:${window.kind}:${window.id}` : null;
}

function matchesPoolWindow(pool: LimitPoolWindow, sample: UsageLimitHistorySample): boolean {
  const firstDriver = pool.members[0]?.account.driver;
  if (firstDriver && sample.driver !== firstDriver) return false;
  if (firstDriver === "codex") {
    return sample.windowKind === pool.kind;
  }
  return sample.windowKind === pool.kind && sample.windowId === pool.id;
}

function memberLabel(member: LimitPoolWindow["members"][number]): string {
  return (
    member.account.displayName ??
    member.account.email?.split("@")[0] ??
    member.account.sourceLabel ??
    String(member.account.driver)
  );
}

export function buildUsageLimitTrajectory(input: {
  readonly pool: LimitPoolWindow;
  readonly samples: readonly UsageLimitHistorySample[];
  readonly nowMs: number;
  readonly mode: BurnRateMode;
}): UsageLimitTrajectory {
  const { pool, samples, nowMs, mode } = input;
  const windowDurationMs = usageLimitDurationMs(pool);
  const currentRemaining = Math.max(0, Math.min(100, pool.remainingPercent));

  const endMs = usageLimitCycleEnd(pool, nowMs) ?? nowMs;
  const startMs = endMs - windowDurationMs;

  // Map every historyKey to its member index & weight share.
  const memberWeights = limitPoolWeights(pool.members);
  const totalWeight = memberWeights.reduce((sum, weight) => sum + weight, 0);
  const keyToMemberIndex = new Map<string, number>();
  pool.members.forEach((member, idx) => {
    keyToMemberIndex.set(member.account.key, idx);
    for (const key of member.account.historyKeys) {
      keyToMemberIndex.set(key, idx);
    }
  });

  const matchingSamples = samples
    .filter(
      (s) =>
        s.checkedAtMs >= startMs - windowDurationMs &&
        s.checkedAtMs <= nowMs + MINUTE_MS &&
        keyToMemberIndex.has(s.accountKey) &&
        matchesPoolWindow(pool, s),
    )
    .toSorted((a, b) => a.checkedAtMs - b.checkedAtMs);

  // Reconstruct pooled historical points from member timelines.
  const recorded: TrajectoryPoint[] = [];
  if (matchingSamples.length > 0) {
    const runningUsed = new Map<number, number>();
    const bucketMs = pool.kind === "session" ? 5 * MINUTE_MS : 20 * MINUTE_MS;
    let lastBucket = -1;
    for (const s of matchingSamples) {
      const idx = keyToMemberIndex.get(s.accountKey)!;
      runningUsed.set(idx, s.usedPercent);
      if (s.checkedAtMs < startMs || runningUsed.size < pool.members.length) continue;
      const bucket = Math.floor(s.checkedAtMs / bucketMs);
      const meanUsed =
        memberWeights.reduce((sum, weight, idx) => sum + weight * runningUsed.get(idx)!, 0) /
        totalWeight;
      const rem = Math.max(0, Math.min(100, 100 - meanUsed));
      if (bucket === lastBucket && recorded.length > 0) {
        recorded[recorded.length - 1] = {
          atMs: Math.min(nowMs, s.checkedAtMs),
          remainingPercent: rem,
        };
      } else {
        recorded.push({ atMs: Math.min(nowMs, s.checkedAtMs), remainingPercent: rem });
        lastBucket = bucket;
      }
    }
  }

  const lastRec = recorded[recorded.length - 1];
  if (
    !lastRec ||
    nowMs - lastRec.atMs > 30_000 ||
    Math.abs(lastRec.remainingPercent - currentRemaining) > 0.2
  ) {
    recorded.push({ atMs: nowMs, remainingPercent: currentRemaining });
  }

  // Determine burn rate (% of pool per hour).
  const evenBurnPerHour = 100 / Math.max(0.25, windowDurationMs / HOUR_MS);
  let burnPercentPerHour = evenBurnPerHour;
  let burnSource: UsageLimitTrajectory["burnSource"] = "even";

  if (mode !== "even") {
    const lookbackMs = mode === "1h" ? HOUR_MS : mode === "3h" ? 3 * HOUR_MS : 6 * HOUR_MS;
    const cutoffMs = nowMs - lookbackMs;
    const windowPoints = recorded.filter((p) => p.atMs >= cutoffMs);
    // Sum positive consumption segments (ignoring upward jumps from past resets)
    let consumed = 0;
    let spanMs = 0;
    if (windowPoints.length >= 2) {
      for (let i = 1; i < windowPoints.length; i += 1) {
        const prev = windowPoints[i - 1]!;
        const curr = windowPoints[i]!;
        const dt = curr.atMs - prev.atMs;
        if (dt <= 0) continue;
        spanMs += dt;
        const drop = prev.remainingPercent - curr.remainingPercent;
        if (drop > 0) consumed += drop;
      }
    }
    if (spanMs >= 10 * MINUTE_MS && matchingSamples.length >= 2) {
      burnPercentPerHour = (consumed / spanMs) * HOUR_MS;
      burnSource = "observed";
    } else {
      // Estimate from current elapsed window consumption
      const activeRates: number[] = [];
      for (const member of pool.members) {
        const resetAt = member.window.resetsAt ? Date.parse(member.window.resetsAt) : Number.NaN;
        const durMs = (member.window.windowDurationMins ?? 0) * MINUTE_MS || windowDurationMs;
        if (Number.isFinite(resetAt) && durMs > 0) {
          const elapsedMs = Math.max(5 * MINUTE_MS, durMs - Math.max(0, resetAt - nowMs));
          activeRates.push((member.window.usedPercent / elapsedMs) * HOUR_MS);
        }
      }
      if (activeRates.length > 0) {
        burnPercentPerHour = activeRates.reduce((a, b) => a + b, 0) / activeRates.length;
        burnSource = "elapsed";
      }
    }
  }

  burnPercentPerHour = Math.max(0, Math.min(200, burnPercentPerHour));

  interface ScheduledRefill {
    readonly atMs: number;
    readonly restoresPercent: number;
    readonly accountLabel: string;
  }
  const scheduled: ScheduledRefill[] = [];
  for (const reset of pool.resets) {
    if (reset.at <= nowMs) continue;
    const label = memberLabel(reset.member);
    if (reset.at <= endMs && reset.restoresPercent > 0) {
      scheduled.push({
        atMs: reset.at,
        restoresPercent: reset.restoresPercent,
        accountLabel: label,
      });
    }
  }
  scheduled.sort((a, b) => a.atMs - b.atMs);

  // Coalesce simultaneous resets within 1 minute so step-ups are crisp.
  const mergedSchedule: Array<{
    atMs: number;
    restoresPercent: number;
    labels: string[];
  }> = [];
  for (const item of scheduled) {
    const prev = mergedSchedule[mergedSchedule.length - 1];
    if (prev && item.atMs - prev.atMs <= MINUTE_MS) {
      prev.restoresPercent = Math.min(100, prev.restoresPercent + item.restoresPercent);
      if (!prev.labels.includes(item.accountLabel)) prev.labels.push(item.accountLabel);
    } else {
      mergedSchedule.push({
        atMs: item.atMs,
        restoresPercent: item.restoresPercent,
        labels: [item.accountLabel],
      });
    }
  }

  // Simulate piecewise-linear projection with vertical step-up refills and 0% floor.
  const projected: TrajectoryPoint[] = [{ atMs: nowMs, remainingPercent: currentRemaining }];
  const refills: TrajectoryRefillEvent[] = [];
  let cursorMs = nowMs;
  let cursorRem = currentRemaining;
  let emptyAtMs: number | null = currentRemaining <= 0 ? nowMs : null;

  const advanceTo = (targetMs: number) => {
    const dtHours = Math.max(0, targetMs - cursorMs) / HOUR_MS;
    if (dtHours <= 0) return;
    if (burnPercentPerHour <= 0 || cursorRem <= 0) {
      cursorMs = targetMs;
      projected.push({ atMs: cursorMs, remainingPercent: cursorRem });
      return;
    }
    const drop = burnPercentPerHour * dtHours;
    if (cursorRem - drop <= 0) {
      const hoursToZero = cursorRem / burnPercentPerHour;
      const touchZeroMs = Math.round(cursorMs + hoursToZero * HOUR_MS);
      if (emptyAtMs === null) emptyAtMs = touchZeroMs;
      projected.push({ atMs: touchZeroMs, remainingPercent: 0 });
      if (touchZeroMs < targetMs) {
        projected.push({ atMs: targetMs, remainingPercent: 0 });
      }
      cursorRem = 0;
      cursorMs = targetMs;
    } else {
      cursorRem = Math.max(0, cursorRem - drop);
      cursorMs = targetMs;
      projected.push({ atMs: cursorMs, remainingPercent: cursorRem });
    }
  };

  for (const step of mergedSchedule) {
    if (step.atMs > endMs) break;
    advanceTo(step.atMs);
    const fromPercent = cursorRem;
    const toPercent = Math.min(100, cursorRem + step.restoresPercent);
    const actualRestored = Math.round(toPercent - fromPercent);
    if (actualRestored > 0) {
      cursorRem = toPercent;
      projected.push({ atMs: step.atMs, remainingPercent: cursorRem });
      refills.push({
        atMs: step.atMs,
        restoresPercent: actualRestored,
        fromPercent,
        toPercent: cursorRem,
        accountLabel: step.labels.join(", "),
      });
    }
  }
  if (cursorMs < endMs) {
    advanceTo(endMs);
  }

  // Compute earliest individual member depletion before its own reset.
  let firstMemberEmpty: UsageLimitTrajectory["firstMemberEmpty"] = null;
  const perMemberBurn = burnPercentPerHour;
  if (perMemberBurn > 0) {
    for (const member of pool.members) {
      const rem = Math.max(0, 100 - member.window.usedPercent);
      if (rem <= 0) {
        firstMemberEmpty = { accountLabel: memberLabel(member), emptyAtMs: nowMs };
        break;
      }
      const hoursLeft = rem / perMemberBurn;
      const memberEmptyMs = Math.round(nowMs + hoursLeft * HOUR_MS);
      const memberResetMs = member.window.resetsAt
        ? Date.parse(member.window.resetsAt)
        : Number.POSITIVE_INFINITY;
      if (memberEmptyMs < memberResetMs && memberEmptyMs <= endMs) {
        if (!firstMemberEmpty || memberEmptyMs < firstMemberEmpty.emptyAtMs) {
          firstMemberEmpty = {
            accountLabel: memberLabel(member),
            emptyAtMs: memberEmptyMs,
          };
        }
      }
    }
  }

  const nextResetEntry = pool.resets.find((r) => r.at > nowMs && r.restoresPercent > 0);

  return {
    startMs,
    nowMs,
    endMs,
    currentRemainingPercent: currentRemaining,
    burnPercentPerHour: Math.round(burnPercentPerHour * 10) / 10,
    burnSource,
    recorded,
    projected,
    refills,
    emptyAtMs,
    firstMemberEmpty,
    nextReset: nextResetEntry
      ? { atMs: nextResetEntry.at, restoresPercent: nextResetEntry.restoresPercent }
      : null,
  };
}
