import { assert, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId, UsageLimitSourceId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";

import { runMigrations } from "../persistence/Migrations.ts";
import * as UsageLimitHistory from "./UsageLimitHistory.ts";

const layer = it.layer(NodeSqliteClient.layer({ filename: ":memory:" }));

layer("UsageLimitHistory", (it) => {
  it.effect(
    "records significant usage limit changes, throttles unchanged probes, and reads history",
    () =>
      Effect.gen(function* () {
        yield* runMigrations();
        const history = yield* UsageLimitHistory.make;

        const makeSnapshot = (checkedAt: string, usedPercent: number, resetsAt: string) => [
          {
            id: UsageLimitSourceId.make("prox-1"),
            kind: "cliproxy" as const,
            label: "Prox Hub",
            checkedAt,
            accounts: [
              {
                id: "claude-1.json",
                driver: ProviderDriverKind.make("claudeAgent"),
                email: "alice@example.com",
                plan: "Max",
                usageLimits: {
                  checkedAt,
                  windows: [
                    {
                      id: "seven_day",
                      kind: "weekly" as const,
                      label: "Weekly",
                      usedPercent,
                      resetsAt,
                    },
                  ],
                },
              },
            ],
          },
        ];

        // 1. Initial sample recorded
        yield* history.recordSources(
          makeSnapshot("2026-11-18T00:00:00.000Z", 20, "2026-11-22T00:00:00.000Z"),
        );

        const restarted = yield* UsageLimitHistory.make;
        yield* restarted.recordSources(
          makeSnapshot("2026-11-18T00:00:00.000Z", 20, "2026-11-22T00:00:00.000Z"),
        );

        // 2. Unchanged sample 2 minutes later is throttled (< 10 min interval)
        yield* history.recordSources(
          makeSnapshot("2026-11-18T00:02:00.000Z", 20.2, "2026-11-22T00:00:00.000Z"),
        );

        // 3. Significant spend (+6%) 4 minutes later IS recorded immediately
        yield* history.recordSources(
          makeSnapshot("2026-11-18T00:04:00.000Z", 26, "2026-11-22T00:00:00.000Z"),
        );

        // 4. Native provider sample also records cleanly
        yield* history.recordProviders([
          {
            instanceId: ProviderInstanceId.make("codex-default"),
            driver: ProviderDriverKind.make("codex"),
            version: null,
            checkedAt: "2026-11-18T00:05:00.000Z",
            skills: [],
            enabled: true,
            installed: true,
            status: "ready",
            auth: { status: "authenticated", email: "bob@example.com" },
            models: [],
            slashCommands: [],
            usageLimits: {
              checkedAt: "2026-11-18T00:05:00.000Z",
              windows: [
                {
                  id: "secondary",
                  kind: "weekly",
                  label: "Weekly",
                  usedPercent: 45,
                  resetsAt: "2026-11-21T12:00:00.000Z",
                },
              ],
            },
          },
        ]);

        const result = yield* history.readHistory({
          sinceMs: Date.parse("2026-11-17T00:00:00.000Z"),
        });

        assert.strictEqual(result.samples.length, 3);
        assert.strictEqual(result.samples[0]?.accountKey, "claudeAgent:alice@example.com");
        assert.strictEqual(result.samples[0]?.usedPercent, 20);
        assert.strictEqual(result.samples[1]?.usedPercent, 26);
        assert.strictEqual(result.samples[2]?.accountKey, "codex:bob@example.com");
        assert.strictEqual(result.samples[2]?.usedPercent, 45);
      }),
  );
});
