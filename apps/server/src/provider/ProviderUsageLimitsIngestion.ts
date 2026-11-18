import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as UsageLimitHistory from "../usage/UsageLimitHistory.ts";
import * as UsageLimitSources from "../usage/UsageLimitSources.ts";
import * as ProviderRegistry from "./ProviderRegistry.ts";

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* ProviderRegistry.ProviderRegistry;
    const sources = yield* UsageLimitSources.UsageLimitSources;
    const history = yield* UsageLimitHistory.UsageLimitHistory;

    yield* Stream.concat(Stream.fromEffect(registry.getProviders), registry.streamChanges).pipe(
      Stream.runForEach((providers) => history.recordProviders(providers)),
      Effect.forkScoped,
    );

    yield* sources.streamChanges.pipe(
      Stream.runForEach((snapshots) => history.recordSources(snapshots)),
      Effect.forkScoped,
    );
  }),
);
