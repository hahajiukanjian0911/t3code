import { EnvironmentId, ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import {
  collectLimitAccounts,
  collectLimitPools,
  displayLimitWindows,
} from "@t3tools/shared/usageLimits";
import { describe, expect, it } from "vite-plus/test";

import { buildUsageLimitTrajectory } from "./UsageLimitTrajectory.logic";

describe("buildUsageLimitTrajectory", () => {
  const nowMs = Date.parse("2026-11-18T12:00:00.000Z");

  function makePool() {
    const presentations = new Map([
      [
        EnvironmentId.make("env-1"),
        {
          entry: { target: { label: "MacBook" } },
          serverConfig: {
            providers: [
              {
                instanceId: ProviderInstanceId.make("claude-1"),
                driver: ProviderDriverKind.make("claudeAgent"),
                displayName: "Claude Team A",
                enabled: true,
                installed: true,
                version: null,
                checkedAt: new Date(nowMs).toISOString(),
                skills: [],
                status: "ready" as const,
                auth: { status: "authenticated" as const, email: "team-a@example.com" },
                models: [],
                slashCommands: [],
                usageLimits: {
                  checkedAt: "2026-11-18T12:00:00.000Z",
                  windows: [
                    {
                      id: "seven_day",
                      kind: "weekly" as const,
                      label: "Weekly",
                      usedPercent: 60,
                      resetsAt: "2026-11-19T06:00:00.000Z",
                      windowDurationMins: 10080,
                    },
                  ],
                },
              },
              {
                instanceId: ProviderInstanceId.make("claude-2"),
                driver: ProviderDriverKind.make("claudeAgent"),
                displayName: "Claude Team B",
                enabled: true,
                installed: true,
                version: null,
                checkedAt: new Date(nowMs).toISOString(),
                skills: [],
                status: "ready" as const,
                auth: { status: "authenticated" as const, email: "team-b@example.com" },
                models: [],
                slashCommands: [],
                usageLimits: {
                  checkedAt: "2026-11-18T12:00:00.000Z",
                  windows: [
                    {
                      id: "seven_day",
                      kind: "weekly" as const,
                      label: "Weekly",
                      usedPercent: 20,
                      resetsAt: "2026-11-20T12:00:00.000Z",
                      windowDurationMins: 10080,
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    ]);
    const pools = collectLimitPools(collectLimitAccounts(presentations), nowMs);
    return displayLimitWindows(pools[0]!)[0]!;
  }

  it("keeps a five-hour cycle anchored to its reset before history arrives", () => {
    const weekly = makePool();
    const reset = nowMs + 4 * 3600_000;
    const member = weekly.members[0]!;
    const pool = {
      ...weekly,
      kind: "session" as const,
      members: [{ ...member, window: { ...member.window, windowDurationMins: 300 } }],
      resets: [{ member, at: reset, restoresPercent: 20 }],
    };
    const result = buildUsageLimitTrajectory({ pool, samples: [], nowMs, mode: "3h" });
    expect(result.startMs).toBe(reset - 5 * 3600_000);
    expect(result.endMs).toBe(reset);
    expect(result.recorded).toEqual([{ atMs: nowMs, remainingPercent: pool.remainingPercent }]);
  });

  it("reconstructs recorded history, computes observed burn rate, and projects step-up refills & empty touch-down", () => {
    const pool = makePool();
    const samples = [
      {
        accountKey: "claudeAgent:team-a@example.com",
        driver: ProviderDriverKind.make("claudeAgent"),
        windowId: "seven_day",
        windowKind: "weekly" as const,
        checkedAtMs: nowMs - 3 * 3600_000,
        usedPercent: 30,
        resetsAtMs: Date.parse("2026-11-19T06:00:00.000Z"),
      },
      {
        accountKey: "claudeAgent:team-b@example.com",
        driver: ProviderDriverKind.make("claudeAgent"),
        windowId: "seven_day",
        windowKind: "weekly" as const,
        checkedAtMs: nowMs - 3 * 3600_000,
        usedPercent: 20,
        resetsAtMs: Date.parse("2026-11-20T12:00:00.000Z"),
      },
      {
        accountKey: "claudeAgent:team-a@example.com",
        driver: ProviderDriverKind.make("claudeAgent"),
        windowId: "seven_day",
        windowKind: "weekly" as const,
        checkedAtMs: nowMs,
        usedPercent: 60,
        resetsAtMs: Date.parse("2026-11-19T06:00:00.000Z"),
      },
    ];

    const trajectory = buildUsageLimitTrajectory({
      pool,
      samples,
      nowMs,
      mode: "3h",
    });

    expect(trajectory.endMs).toBe(Date.parse("2026-11-19T06:00:00.000Z"));
    expect(trajectory.endMs - trajectory.startMs).toBe(7 * 24 * 3600_000);

    // Pool went from 75% remaining -> 60% remaining over 3 hours = 5%/h burn rate.
    expect(trajectory.currentRemainingPercent).toBe(60);
    expect(trajectory.burnSource).toBe("observed");
    expect(trajectory.burnPercentPerHour).toBeCloseTo(5, 1);

    // At 5%/h from 60%, pool hits 0% in 12 hours (before 18h reset of Team A).
    expect(trajectory.emptyAtMs).toBe(nowMs + 12 * 3600_000);

    // At +18h (2026-11-19T06:00Z), Team A resets and restores +30% of pool!
    expect(trajectory.refills.length).toBeGreaterThanOrEqual(1);
    expect(trajectory.refills[0]?.atMs).toBe(Date.parse("2026-11-19T06:00:00.000Z"));
    expect(trajectory.refills[0]?.restoresPercent).toBe(30);
    expect(trajectory.refills[0]?.fromPercent).toBe(0);
    expect(trajectory.refills[0]?.toPercent).toBe(30);
  });
});
