import type {
  ProviderDriverKind,
  ServerProvider,
  UsageLimitHistory as UsageLimitHistoryResult,
  UsageLimitHistoryInput,
  UsageLimitHistorySample,
  UsageLimitSourceSnapshot,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { isProviderAvailable } from "@t3tools/contracts";
import { limitsNotice, resolveUsageLimitAccountKey } from "@t3tools/shared/usageLimits";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/sql/SqlClient";

const RETENTION_MS = 14 * 24 * 60 * 60 * 1_000;
const MIN_UNCHANGED_SAMPLE_INTERVAL_MS = 10 * 60 * 1_000;
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const MAX_RETURNED_SAMPLES = 15_000;

export interface UsageLimitSamplePoint {
  readonly accountKey: string;
  readonly driver: ProviderDriverKind;
  readonly windowId: string;
  readonly windowKind: "session" | "weekly" | "monthly" | "other";
  readonly checkedAtMs: number;
  readonly usedPercent: number;
  readonly resetsAtMs: number | null;
}

export class UsageLimitHistory extends Context.Reference<{
  readonly recordProviders: (providers: ReadonlyArray<ServerProvider>) => Effect.Effect<void>;
  readonly recordSources: (sources: ReadonlyArray<UsageLimitSourceSnapshot>) => Effect.Effect<void>;
  readonly readHistory: (input: UsageLimitHistoryInput) => Effect.Effect<UsageLimitHistoryResult>;
}>("t3/usage/UsageLimitHistory", {
  defaultValue: () => ({
    recordProviders: () => Effect.void,
    recordSources: () => Effect.void,
    readHistory: () =>
      DateTime.now.pipe(
        Effect.map((now) => ({
          readAt: DateTime.formatIso(now),
          samples: [],
        })),
      ),
  }),
}) {}

function parseTimestampMs(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function extractSamplesFromProviders(
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<UsageLimitSamplePoint> {
  const out: UsageLimitSamplePoint[] = [];
  for (const provider of providers) {
    if (
      !provider.enabled ||
      !provider.installed ||
      !isProviderAvailable(provider) ||
      !provider.usageLimits ||
      limitsNotice(provider.usageLimits) !== null
    ) {
      continue;
    }
    const checkedAtMs = parseTimestampMs(provider.usageLimits.checkedAt);
    if (checkedAtMs === null) continue;
    const accountKey = resolveUsageLimitAccountKey(
      provider.driver,
      provider.auth.email,
      provider.auth.workspaceId,
      provider.usageLimits,
      `instance:${provider.instanceId}`,
    );
    for (const window of provider.usageLimits.windows) {
      out.push({
        accountKey,
        driver: provider.driver,
        windowId: window.id,
        windowKind: window.kind,
        checkedAtMs,
        usedPercent: Math.max(0, Math.min(100, window.usedPercent)),
        resetsAtMs: parseTimestampMs(window.resetsAt),
      });
    }
  }
  return out;
}

function extractSamplesFromSources(
  sources: ReadonlyArray<UsageLimitSourceSnapshot>,
): ReadonlyArray<UsageLimitSamplePoint> {
  const out: UsageLimitSamplePoint[] = [];
  for (const source of sources) {
    for (const account of source.accounts) {
      if (limitsNotice(account.usageLimits) !== null) continue;
      const checkedAtMs = parseTimestampMs(account.usageLimits.checkedAt);
      if (checkedAtMs === null) continue;
      const fallbackKey = `source:${source.id}:${account.id}${account.workspaceId ? `:${account.workspaceId}` : ""}`;
      const accountKey = resolveUsageLimitAccountKey(
        account.driver,
        account.email,
        account.workspaceId,
        account.usageLimits,
        fallbackKey,
      );
      for (const window of account.usageLimits.windows) {
        out.push({
          accountKey,
          driver: account.driver,
          windowId: window.id,
          windowKind: window.kind,
          checkedAtMs,
          usedPercent: Math.max(0, Math.min(100, window.usedPercent)),
          resetsAtMs: parseTimestampMs(window.resetsAt),
        });
      }
    }
  }
  return out;
}

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const lastPrunedRef = yield* Ref.make(0);

  const recordSamples = Effect.fn("UsageLimitHistory.recordSamples")(function* (
    candidates: ReadonlyArray<UsageLimitSamplePoint>,
  ) {
    if (candidates.length === 0) return;
    const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
    yield* sql
      .withTransaction(
        Effect.forEach(
          candidates,
          (point) => sql`
        INSERT INTO usage_limit_samples
          (account_key, driver, window_id, window_kind, checked_at_ms, used_percent, resets_at_ms)
        SELECT ${point.accountKey}, ${point.driver}, ${point.windowId}, ${point.windowKind},
               ${point.checkedAtMs}, ${point.usedPercent}, ${point.resetsAtMs}
        WHERE NOT EXISTS (
          SELECT 1 FROM (
            SELECT checked_at_ms, used_percent, resets_at_ms
            FROM usage_limit_samples
            WHERE account_key = ${point.accountKey} AND window_id = ${point.windowId}
            ORDER BY checked_at_ms DESC, id DESC LIMIT 1
          )
          WHERE checked_at_ms >= ${point.checkedAtMs}
             OR (checked_at_ms > ${point.checkedAtMs - MIN_UNCHANGED_SAMPLE_INTERVAL_MS}
                 AND ABS(used_percent - ${point.usedPercent}) < 0.5
                 AND ABS(COALESCE(resets_at_ms, 0) - ${point.resetsAtMs ?? 0}) <= 60000)
        )
      `,
          { discard: true },
        ),
      )
      .pipe(Effect.ignoreCause({ log: true }));

    const lastPruned = yield* Ref.get(lastPrunedRef);
    if (nowMs - lastPruned >= PRUNE_INTERVAL_MS) {
      const cutoff = nowMs - RETENTION_MS;
      yield* sql`
        DELETE FROM usage_limit_samples
        WHERE checked_at_ms < ${cutoff}
      `.pipe(Effect.andThen(Ref.set(lastPrunedRef, nowMs)), Effect.ignoreCause({ log: true }));
    }
  });

  const readHistory = Effect.fn("UsageLimitHistory.readHistory")(function* (
    input: UsageLimitHistoryInput,
  ) {
    const now = yield* DateTime.now;
    const readAt = DateTime.formatIso(now);
    const minSince = Math.max(0, DateTime.toEpochMillis(now) - RETENTION_MS);
    const sinceMs = Math.max(minSince, Math.trunc(input.sinceMs));
    const rows = yield* sql<{
      readonly account_key: string;
      readonly driver: ProviderDriverKind;
      readonly window_id: string;
      readonly window_kind: "session" | "weekly" | "monthly" | "other";
      readonly checked_at_ms: number;
      readonly used_percent: number;
      readonly resets_at_ms: number | null;
    }>`
      SELECT
        account_key,
        driver,
        window_id,
        window_kind,
        checked_at_ms,
        used_percent,
        resets_at_ms
      FROM usage_limit_samples
      WHERE checked_at_ms >= ${sinceMs}
      ORDER BY checked_at_ms DESC, id DESC
      LIMIT ${MAX_RETURNED_SAMPLES}
    `.pipe(
      NodeSqliteClient.readOnly,
      Effect.orElseSucceed(() => []),
    );

    const samples: UsageLimitHistorySample[] = rows.toReversed().map((row) => ({
      accountKey: row.account_key,
      driver: row.driver,
      windowId: row.window_id,
      windowKind: row.window_kind,
      checkedAtMs: row.checked_at_ms,
      usedPercent: Math.max(0, Math.min(100, row.used_percent)),
      resetsAtMs: row.resets_at_ms,
    }));

    return {
      readAt,
      samples,
    } satisfies UsageLimitHistoryResult;
  });

  return {
    recordProviders: (providers: ReadonlyArray<ServerProvider>) =>
      recordSamples(extractSamplesFromProviders(providers)),
    recordSources: (sources: ReadonlyArray<UsageLimitSourceSnapshot>) =>
      recordSamples(extractSamplesFromSources(sources)),
    readHistory,
  };
});

export const layer = Layer.effect(UsageLimitHistory, make);
