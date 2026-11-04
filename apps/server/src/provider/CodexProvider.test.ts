import { assert, it } from "@effect/vitest";
import { CodexSettings } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import {
  applyPreferredCodexDefaultModel,
  checkCodexProviderStatus,
  mapCodexModelCapabilities,
} from "./CodexProvider.ts";

const decodeCodexSettings = Schema.decodeSync(CodexSettings);
const defaultCodexSettings = decodeCodexSettings({});

it.effect.each([
  { name: "accepts a slow reply", delay: "4500 millis", reply: true },
  {
    name: "bounds a missing reply without losing authentication",
    delay: "10 seconds",
    reply: false,
  },
] as const)("Codex usage read $name", ({ delay, reply }) =>
  Effect.gen(function* () {
    const responses = yield* Queue.unbounded<Uint8Array>();
    const usageRequested = yield* Deferred.make<number>();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const respond = (id: number, result: unknown) =>
      Queue.offer(responses, encoder.encode(`${JSON.stringify({ id, result })}\n`));
    const replies: Readonly<Record<string, unknown>> = {
      initialize: {
        userAgent: "codex/0.166.0-alpha.5.1",
        codexHome: "/codex-home",
        platformFamily: "unix",
        platformOs: "macos",
      },
      "account/read": {
        account: { type: "chatgpt", email: "test@example.com", planType: "pro" },
        requiresOpenaiAuth: true,
      },
      "skills/list": { data: [] },
      "model/list": { data: [], nextCursor: null },
      "config/read": { config: {} },
    };
    const spawner = ChildProcessSpawner.make(() =>
      Effect.succeed(
        ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(1),
          exitCode: Effect.never,
          isRunning: Effect.succeed(true),
          kill: () => Effect.void,
          unref: Effect.succeed(Effect.void),
          stdin: Sink.forEach((chunk: Uint8Array) => {
            const message = JSON.parse(decoder.decode(chunk)) as { id?: number; method: string };
            if (message.id === undefined) return Effect.void;
            if (message.method === "account/rateLimits/read") {
              return Deferred.succeed(usageRequested, message.id);
            }
            return respond(message.id, replies[message.method]);
          }),
          stdout: Stream.fromQueue(responses),
          stderr: Stream.empty,
          all: Stream.empty,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
        }),
      ),
    );
    const fetchedAt = DateTime.formatIso(yield* DateTime.now);
    const fiber = yield* checkCodexProviderStatus(defaultCodexSettings).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.provideService(
        FileSystem.FileSystem,
        FileSystem.makeNoop({
          readFileString: () => Effect.succeed(JSON.stringify({ fetched_at: fetchedAt })),
        }),
      ),
      Effect.provide(Path.layer),
      Effect.forkChild,
    );
    const requestId = yield* Deferred.await(usageRequested);
    yield* TestClock.adjust(delay);
    if (reply) {
      yield* respond(requestId, {
        rateLimits: {
          limitId: "codex",
          planType: "pro",
          primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1_800_000_000 },
        },
      });
    }
    const status = yield* Fiber.join(fiber);
    assert.strictEqual(status.status, "ready");
    assert.strictEqual(status.auth.status, "authenticated");
    if (reply) {
      assert.isUndefined(status.usageLimits?.unavailable);
      assert.strictEqual(status.usageLimits?.windows[0]?.usedPercent, 25);
    } else {
      assert.deepStrictEqual(status.usageLimits?.unavailable, {
        reason: "probeFailed",
        message: "Codex did not answer the usage request.",
      });
    }
  }),
);

it("maps current Codex model capability fields", () => {
  const capabilities = mapCodexModelCapabilities({
    additionalSpeedTiers: [],
    defaultReasoningEffort: "super-high",
    description: "Test model",
    displayName: "GPT Test",
    hidden: false,
    id: "gpt-test",
    isDefault: true,
    model: "gpt-test",
    defaultServiceTier: "flex",
    serviceTiers: [
      {
        id: "priority",
        name: "Fast",
        description: "Lower latency responses.",
      },
      {
        id: "flex",
        name: "Flex",
        description: "Lower-cost asynchronous routing.",
      },
    ],
    supportedReasoningEfforts: [
      {
        description: "Maximum reasoning",
        reasoningEffort: "super-high",
      },
    ],
  });

  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      options: [{ id: "super-high", label: "super-high", isDefault: true }],
      currentValue: "super-high",
    },
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard" },
        {
          id: "priority",
          label: "Fast",
          description: "Lower latency responses.",
        },
        {
          id: "flex",
          label: "Flex",
          description: "Lower-cost asynchronous routing.",
          isDefault: true,
        },
      ],
      currentValue: "flex",
    },
  ]);
});

it("uses standard routing when the catalog has no default service tier", () => {
  const capabilities = mapCodexModelCapabilities({
    additionalSpeedTiers: ["fast"],
    defaultReasoningEffort: "medium",
    defaultServiceTier: null,
    description: "Test model",
    displayName: "GPT Test",
    hidden: false,
    id: "gpt-test",
    isDefault: true,
    model: "gpt-test",
    serviceTiers: [
      {
        id: "priority",
        name: "Fast",
        description: "1.5x speed, increased usage",
      },
      {
        id: "ultrafast",
        name: "Ultrafast",
        description: "The fastest available responses for latency-sensitive work.",
      },
    ],
    supportedReasoningEfforts: [],
  });

  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard", isDefault: true },
        {
          id: "priority",
          label: "Fast",
          description: "1.5x speed, increased usage",
        },
        {
          id: "ultrafast",
          label: "Ultrafast",
          description: "Even faster, more expensive",
        },
      ],
      currentValue: "default",
    },
  ]);
});

it("marks the most preferred available model as default", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.6-terra", name: "GPT-5.6-Terra", isCustom: false, capabilities: null },
    { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, isDefault: true, capabilities: null },
  ]);

  assert.deepStrictEqual(
    models.map((model) => ({ slug: model.slug, isDefault: model.isDefault })),
    [
      { slug: "gpt-5.6-terra", isDefault: true },
      { slug: "gpt-5.4", isDefault: undefined },
    ],
  );
});

it("ranks qualified Codex models while preserving their wire ids", () => {
  const models = applyPreferredCodexDefaultModel([
    {
      slug: "openai.gpt-5.6-luna",
      name: "Luna",
      isCustom: false,
      isDefault: true,
      capabilities: null,
    },
    { slug: "openai.gpt-5.6-sol", name: "Sol", isCustom: false, capabilities: null },
  ]);
  assert.deepStrictEqual(
    models.filter((model) => model.isDefault).map((model) => model.slug),
    ["openai.gpt-5.6-sol"],
  );
});

it("ignores custom models that shadow a preferred slug", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.6-sol", name: "gpt-5.6-sol", isCustom: true, capabilities: null },
    { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, isDefault: true, capabilities: null },
  ]);

  assert.deepStrictEqual(models.find((model) => model.isDefault)?.slug, "gpt-5.4");
});
